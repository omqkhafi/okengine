/**
 * End-to-end AS endpoint tests — CIMD resolution, authorize validation,
 * PKCE, DPoP, resource binding, refresh rotation. Uses an injected CIMD
 * loader and a fixed clock; no network.
 */

import { describe, expect, test } from "bun:test";
import { createDpopSigner } from "./crypto.ts";
import { OAuthError } from "./errors.ts";
import { hashSecret } from "./stores.ts";
import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  createOauthAs,
  upsertConsent,
  type OauthAsOptions,
} from "./http.ts";
import { createAsStores } from "./stores.ts";

const T0 = 1_700_000_000_000;
const now = () => T0;

const CLIENT_ID = "https://app.example.com/oauth-client-metadata.json";
const RESOURCE = "https://mcp.example.com/mcp";
const REDIRECT = "https://app.example.com/callback";

function makeCimdDoc(): Record<string, unknown> {
  return {
    client_id: CLIENT_ID,
    client_name: "Test Agent",
    redirect_uris: [REDIRECT],
    scope: "mcp:tools openid",
  };
}

function makeOptions(): OauthAsOptions & { stores: ReturnType<typeof createAsStores> } {
  return {
    issuer: "https://as.example.com",
    resource: RESOURCE,
    stores: createAsStores(),
    now,
    fetchDoc: async (url) => (url === CLIENT_ID ? makeCimdDoc() : {}),
    userFromRequest: async () => "user-1",
  };
}

/** Pre-seed a covering consent row so authorize issues a code directly. */
function seedConsent(options: ReturnType<typeof makeOptions>, scope: string): void {
  upsertConsent(options.stores, {
    userId: "user-1",
    clientId: CLIENT_ID,
    clientName: "Test Agent",
    resource: RESOURCE,
    scope: scope.split(" "),
    now: T0,
  });
}

/** Drive GET /oauth/authorize and pull the code out of the Location. */
async function authorize(
  options: typeof makeOptions extends () => infer O ? O : never,
  query: Record<string, string>,
): Promise<{ status: number; location?: string; body: unknown }> {
  const url = new URL("https://as.example.com/oauth/authorize");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const facade = createOauthAs(options);
  const response = await facade.edge(new Request(url.toString()), {
    method: "GET",
    path: "/oauth/authorize",
  });
  if (!response) throw new Error("authorize not handled");
  const location = response.headers.get("location") ?? undefined;
  return {
    status: response.status,
    location,
    body: response.status === 302 ? undefined : await response.json(),
  };
}

async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = `v-${crypto.randomUUID()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const challenge = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { verifier, challenge };
}

async function postToken(
  options: ReturnType<typeof makeOptions>,
  form: Record<string, string>,
  proof?: string,
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (proof !== undefined) headers.dpop = proof;
  const request = new Request("https://as.example.com/oauth/token", {
    method: "POST",
    headers,
    body: new URLSearchParams(form),
  });
  const facade = createOauthAs(options);
  const response = await facade.edge(request, { method: "POST", path: "/oauth/token" });
  if (!response) throw new Error("token endpoint not handled");
  return response;
}

describe("oauth-as endpoints", () => {
  test("metadata documents advertise DPoP + S256 + resource", async () => {
    expect(buildAuthorizationServerMetadata("https://as.example.com/")).toMatchObject({
      issuer: "https://as.example.com",
      token_endpoint: "https://as.example.com/oauth/token",
      dpop_signing_alg_values_supported: ["ES256"],
      code_challenge_methods_supported: ["S256"],
    });
    expect(buildProtectedResourceMetadata(RESOURCE, "https://as.example.com")).toMatchObject({
      resource: RESOURCE,
      authorization_servers: ["https://as.example.com"],
    });
  });

  test("full happy path: CIMD authorize → code → DPoP token", async () => {
    const options = makeOptions();
    seedConsent(options, "mcp:tools");
    const { verifier, challenge } = await pkcePair();
    const authRes = await authorize(options, {
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      scope: "mcp:tools",
      state: "xyz",
      resource: RESOURCE,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    expect(authRes.status).toBe(302);
    const location = authRes.location ?? "";
    expect(location.startsWith(`${REDIRECT}?`)).toBe(true);
    const params = new URL(location);
    const code = params.searchParams.get("code");
    expect(code).toBeTruthy();
    expect(params.searchParams.get("state")).toBe("xyz");
    expect(params.searchParams.get("iss")).toBe("https://as.example.com");

    // Code must be single-use and stored hashed.
    const codeHash = await hashSecret(code ?? "");
    const rows = [...options.stores.authCodes.values()];
    expect(rows.some((r) => r.codeHash === codeHash)).toBe(true);

    const signer = await createDpopSigner();
    const proof = await signer.prove({
      htm: "POST",
      htu: "https://as.example.com/oauth/token",
      now: T0,
    });
    const tokenRes = await postToken(
      options,
      {
        grant_type: "authorization_code",
        code: code ?? "",
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
        resource: RESOURCE,
      },
      proof,
    );
    expect(tokenRes.status).toBe(200);
    const body = (await tokenRes.json()) as Record<string, unknown>;
    expect(body.token_type).toBe("DPoP");
    expect(body.refresh_token).toBeTruthy();

    // Access token carries cnf.jkt bound to the signer key.
    const access = body.access_token as string;
    const payload = JSON.parse(
      atob(access.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")),
    ) as Record<string, unknown>;
    expect(payload.aud).toBe(RESOURCE);
    expect(payload.client_id).toBe(CLIENT_ID);
    expect((payload.cnf as Record<string, string>).jkt).toBeTruthy();
  });

  test("missing / mismatched resource is rejected with invalid_target", async () => {
    const options = makeOptions();
    const { challenge } = await pkcePair();
    const res = await authorize(options, {
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      resource: "https://other.example.com/mcp",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    expect(res.status).toBe(302);
    expect(new URL(res.location ?? "").searchParams.get("error")).toBe("invalid_target");
  });

  test("PKCE is mandatory and wrong verifier fails the grant", async () => {
    const options = makeOptions();
    const res = await authorize(options, {
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      resource: RESOURCE,
    });
    expect(res.status).toBe(302);
    expect(new URL(res.location ?? "").searchParams.get("error")).toBe("invalid_request");

    // Now a valid authorize but bad verifier at token time.
    const { verifier, challenge } = await pkcePair();
    seedConsent(options, "mcp:tools");
    const ok = await authorize(options, {
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      resource: RESOURCE,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const code = new URL(ok.location ?? "").searchParams.get("code") ?? "";
    const signer = await createDpopSigner();
    const proof = await signer.prove({
      htm: "POST",
      htu: "https://as.example.com/oauth/token",
      now: T0,
    });
    const tokenRes = await postToken(
      options,
      {
        grant_type: "authorization_code",
        code,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT,
        code_verifier: `${verifier}-tampered`,
        resource: RESOURCE,
      },
      proof,
    );
    expect(tokenRes.status).toBe(400);
    expect(((await tokenRes.json()) as Record<string, string>).error).toBe("invalid_grant");
  });

  test("token without DPoP proof is rejected", async () => {
    const options = makeOptions();
    const { verifier, challenge } = await pkcePair();
    const ok = await authorize(options, {
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      resource: RESOURCE,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const code = new URL(ok.location ?? "").searchParams.get("code") ?? "";
    const res = await postToken(options, {
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
      resource: RESOURCE,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, string>).error).toBe("invalid_request");
  });

  test("authorization code is single-use (replay → invalid_grant)", async () => {
    const options = makeOptions();
    seedConsent(options, "mcp:tools");
    const { verifier, challenge } = await pkcePair();
    const ok = await authorize(options, {
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      resource: RESOURCE,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const code = new URL(ok.location ?? "").searchParams.get("code") ?? "";
    const signer = await createDpopSigner();
    const form = {
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
      resource: RESOURCE,
    };
    const first = await postToken(
      options,
      form,
      await signer.prove({ htm: "POST", htu: "https://as.example.com/oauth/token", now: T0 }),
    );
    expect(first.status).toBe(200);
    const second = await postToken(
      options,
      form,
      await signer.prove({ htm: "POST", htu: "https://as.example.com/oauth/token", now: T0 }),
    );
    expect(second.status).toBe(400);
    expect(((await second.json()) as Record<string, string>).error).toBe("invalid_grant");
  });

  test("unconsented user is parked to consent screen; approve mints code", async () => {
    const options = makeOptions();
    const facade = createOauthAs(options);
    const { verifier, challenge } = await pkcePair();
    const authRes = await authorize(options, {
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      scope: "mcp:tools profile",
      resource: RESOURCE,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    // First run has no consent row → parked at consent screen.
    const pendingId = new URL(authRes.location ?? "").searchParams.get("consent");
    expect(pendingId).toBeTruthy();

    const description = facade.describeConsent(pendingId ?? "");
    expect(description.clientName).toBe("Test Agent");
    expect([...description.scope]).toEqual(["mcp:tools", "profile"]);

    const approved = await facade.approveConsent(pendingId ?? "", "user-1");
    const code = new URL(approved.redirectTo).searchParams.get("code");
    expect(code).toBeTruthy();

    // Wrong user cannot approve someone else's consent.
    const auth2 = await authorize(options, {
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      scope: "openid",
      resource: RESOURCE,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const pending2 = new URL(auth2.location ?? "").searchParams.get("consent") ?? "";
    expect(() => facade.approveConsent(pending2, "attacker-1")).toThrow(OAuthError);

    void verifier;
  });

  test("refresh rotation: reuse burns the whole family", async () => {
    const options = makeOptions();
    seedConsent(options, "mcp:tools");
    const { verifier, challenge } = await pkcePair();
    const ok = await authorize(options, {
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      resource: RESOURCE,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const code = new URL(ok.location ?? "").searchParams.get("code") ?? "";
    const signer = await createDpopSigner();
    const prove = () =>
      signer.prove({ htm: "POST", htu: "https://as.example.com/oauth/token", now: T0 });
    const first = (await (
      await postToken(
        options,
        {
          grant_type: "authorization_code",
          code,
          client_id: CLIENT_ID,
          redirect_uri: REDIRECT,
          code_verifier: verifier,
          resource: RESOURCE,
        },
        await prove(),
      )
    ).json()) as Record<string, string>;

    const refreshForm = {
      grant_type: "refresh_token",
      refresh_token: first.refresh_token!,
      client_id: CLIENT_ID,
      resource: RESOURCE,
    };
    const rotated = await postToken(options, refreshForm, await prove());
    expect(rotated.status).toBe(200);
    const rotatedBody = (await rotated.json()) as Record<string, string>;
    expect(rotatedBody.refresh_token).not.toBe(first.refresh_token);

    // Replaying the OLD refresh token revokes the family.
    const replay = await postToken(options, refreshForm, await prove());
    expect(replay.status).toBe(400);
    const afterRevoke = await postToken(
      options,
      {
        grant_type: "refresh_token",
        refresh_token: rotatedBody.refresh_token!,
        client_id: CLIENT_ID,
        resource: RESOURCE,
      },
      await prove(),
    );
    expect(afterRevoke.status).toBe(400);
    expect(((await afterRevoke.json()) as Record<string, string>).error).toBe("invalid_grant");
  });

  test("redirect_uri must be exactly registered", async () => {
    const options = makeOptions();
    const { challenge } = await pkcePair();
    const res = await authorize(options, {
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: "https://app.example.com/callback/",
      resource: RESOURCE,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    // Not a registered exact match → generic 400 JSON (no redirect).
    expect(res.status).toBe(400);
    expect(res.body).toBeDefined();
  });
});
