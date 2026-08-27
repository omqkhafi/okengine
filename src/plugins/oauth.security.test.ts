/**
 * Exploit-proof security audit for the OAuth social-login plugin.
 *
 * Real HTTP against a booted app whose drivers talk to a mock IdP
 * (injectable fetch). Covers the two locked threat classes:
 * - GHSA-6g38-8j4p-j3pr — unverified-email account takeover blocked at
 *   `linkOrProvision`; authenticated linking still succeeds (control).
 * - Mix-up (RFC 9700 §4.4 / RFC 9207) — cross-provider state replay and
 *   wrong-issuer ID tokens rejected; flow rows are single-use.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { memoryVaultDriver } from "../drivers/index.ts";
import { createIdentityStore, type IdentityStore } from "../auth/identity.ts";
import { rawToJose } from "../drivers/oauth-oidc.ts";
import { parseEmailVerified } from "../drivers/oauth-shared.ts";
import { openOAuthDiscord } from "../drivers/oauth-discord.ts";
import { openOAuthGithub } from "../drivers/oauth-github.ts";
import { verifyIdToken } from "../drivers/oauth-oidc.ts";
import { base64UrlEncode } from "../drivers/oauth-shared.ts";
import { oke } from "../kernel/app.ts";
import { resetFlowSeq } from "../kernel/flow.ts";
import { resetBindings } from "../kernel/on.ts";
import { oauth } from "./oauth.ts";

afterEach(() => {
  resetBindings();
  resetFlowSeq();
});

const SECRET = "test-secret-at-least-16";

/** Client secrets seeded into the memory vault chain for every harness. */
const VAULT_SEED: Readonly<Record<string, string>> = {
  OAUTH_GOOGLE_CLIENT_SECRET: "g-secret",
  OAUTH_GITHUB_CLIENT_SECRET: "gh-secret",
  OAUTH_DISCORD_CLIENT_SECRET: "dc-secret",
  OAUTH_FACEBOOK_CLIENT_SECRET: "fb-secret",
};

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

function jsonPost(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function readError(res: Response): Promise<{ code?: string; reason?: string }> {
  const body = (await res.json()) as {
    error?: { code?: string; data?: { reason?: string } };
  };
  return { code: body.error?.code, reason: body.error?.data?.reason };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface MockRoute {
  readonly match: (url: URL) => boolean;
  readonly respond: () => Response | Promise<Response>;
}

function jsonRoute(match: (url: URL) => boolean, body: unknown, status = 200): MockRoute {
  return { match, respond: () => jsonResponse(body, status) };
}

/**
 * Provider-side mock: routes requests to matching stubs and records every
 * URL so tests can prove a step was (or was never) reached.
 */
function mockFetch(
  routes: readonly MockRoute[],
  calls: { readonly urls: string[] } = { urls: [] },
): typeof globalThis.fetch {
  const impl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    void init;
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.urls.push(url.href);
    for (const route of routes) {
      if (route.match(url)) return await route.respond();
    }
    throw new Error(`mock IdP: no route for ${url.href}`);
  };
  return impl as typeof globalThis.fetch;
}

async function bootHarness(fetchFn: typeof globalThis.fetch): Promise<{
  app: ReturnType<typeof buildOauthApp>;
  identities: IdentityStore;
}> {
  const app = buildOauthApp(fetchFn);
  await app.boot({
    env: "test",
    vault: {
      chain: [
        { driver: memoryVaultDriver, source: "driver", options: { secrets: { ...VAULT_SEED } } },
      ],
    },
  });
  return { app, identities: harnessIdentities(app) };
}

function buildOauthApp(fetchFn: typeof globalThis.fetch) {
  // One shared store for Gate auth AND the OAuth plugin — the same rule the
  // production wiring enforces via `resolveSharedIdentities`.
  const identities = createIdentityStore();
  const app = oke({
    name: `oauth-sec-${crypto.randomUUID()}`,
    env: "test",
    registry: "ignore",
    gate: {
      auth: { secret: SECRET, emailAndPassword: { enabled: true }, identities },
      unguardedHttp: "deny",
    },
  }).plug(
    oauth({
      secret: SECRET,
      identities,
      fetch: fetchFn,
      providers: {
        google: {
          enabled: true,
          clientId: "g-client",
          redirectUri: "https://app.example.com/auth/oauth/callback/google",
        },
        github: {
          enabled: true,
          clientId: "gh-client",
          redirectUri: "https://app.example.com/auth/oauth/callback/github",
        },
        discord: {
          enabled: true,
          clientId: "dc-client",
          redirectUri: "https://app.example.com/auth/oauth/callback/discord",
        },
        facebook: {
          enabled: true,
          clientId: "fb-client",
          redirectUri: "https://app.example.com/auth/oauth/callback/facebook",
        },
      },
    }),
  );
  appWithIdentities.set(app, identities);
  return app;
}

const appWithIdentities = new WeakMap<object, IdentityStore>();

function harnessIdentities(app: ReturnType<typeof buildOauthApp>): IdentityStore {
  const store = appWithIdentities.get(app);
  if (!store) throw new Error("harness identities missing");
  return store;
}

async function startOAuth(
  app: ReturnType<typeof buildOauthApp>,
  provider: string,
): Promise<{ authorizationUrl: string; state: string }> {
  const res = await app.fetch(jsonPost(`/auth/oauth/${provider}/start`, { provider }));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { authorizationUrl: string } };
  const state = new URL(body.data.authorizationUrl).searchParams.get("state");
  expect(state).toBeTruthy();
  return { authorizationUrl: body.data.authorizationUrl, state: state! };
}

function callbackGet(provider: string, state: string, code = "auth-code"): Request {
  return new Request(
    `http://localhost/auth/oauth/callback/${provider}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
  );
}

async function signUpViaPassword(
  app: ReturnType<typeof buildOauthApp>,
  email: string,
): Promise<{ userId: string; accessToken: string }> {
  const res = await app.fetch(
    jsonPost("/auth/sign-up/email", { email, password: "CorrectHorse1!" }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { userId: string; accessToken: string } };
  return body.data;
}

/**
 * Craft a real ES256-signed ID token ("attacker-minted") plus the JWK that
 * verifies it, for mix-up simulations.
 */
async function signEs256IdToken(claims: Readonly<Record<string, unknown>>): Promise<{
  token: string;
  publicKeyJwk: Record<string, unknown>;
}> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const exported = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Record<
    string,
    unknown
  >;
  const enc = new TextEncoder();
  const header = base64UrlEncode(enc.encode(JSON.stringify({ alg: "ES256", kid: "atk-kid" })));
  const payload = base64UrlEncode(enc.encode(JSON.stringify(claims)));
  const der = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      pair.privateKey,
      enc.encode(`${header}.${payload}`),
    ),
  );
  return {
    token: `${header}.${payload}.${rawToJose(der.subarray(0, 32), der.subarray(32))}`,
    publicKeyJwk: { ...exported, kid: "atk-kid", alg: "ES256" },
  };
}

/* ------------------------------------------------------------------ */
/* (a) GHSA-6g38-8j4p-j3pr — unverified-email hijack                   */
/* ------------------------------------------------------------------ */

describe("GHSA-6g38-8j4p-j3pr — unverified email hijack", () => {
  test("Facebook callback claiming a registered email cannot sign in as the victim", async () => {
    const victimEmail = "victim@example.com";
    const calls = { urls: [] as string[] };
    const { app, identities } = await bootHarness(
      mockFetch(
        [
          jsonRoute(
            (u) => u.href.startsWith("https://graph.facebook.com/v21.0/oauth/access_token"),
            { access_token: "fb-at", token_type: "bearer" },
          ),
          jsonRoute((u) => u.href.startsWith("https://graph.facebook.com/v21.0/me"), {
            id: "fb-evildoer",
            name: "Evildoer",
            email: victimEmail,
          }),
        ],
        calls,
      ),
    );

    const victim = await signUpViaPassword(app, victimEmail);

    const { state } = await startOAuth(app, "facebook");
    const res = await app.fetch(callbackGet("facebook", state));
    expect(res.status).toBeGreaterThanOrEqual(400);
    const err = await readError(res);
    // Enumeration hygiene: email_in_use, never "email belongs to victim".
    expect(err.reason).toBe("email_in_use");

    // Victim untouched; attacker gained no credential row.
    expect(identities.byEmail.get(victimEmail)).toBe(victim.userId);
    expect(identities.byProvider.has("oauth:facebook:fb-evildoer")).toBe(false);
    expect(calls.urls.some((u) => u.includes("/me"))).toBe(true);

    // Victim's original credential still authenticates.
    const relogin = await app.fetch(
      jsonPost("/auth/sign-in/email", { email: victimEmail, password: "CorrectHorse1!" }),
    );
    expect(relogin.status).toBe(200);

    await app.stop();
  });

  test("control: fresh unverified Facebook email provisions normally with emailVerified=false", async () => {
    const { app, identities } = await bootHarness(
      mockFetch([
        jsonRoute((u) => u.href.startsWith("https://graph.facebook.com/v21.0/oauth/access_token"), {
          access_token: "fb-at",
        }),
        jsonRoute((u) => u.href.startsWith("https://graph.facebook.com/v21.0/me"), {
          id: "fb-newbie",
          name: "Newbie",
          email: "fresh-fb@example.com",
        }),
      ]),
    );

    const { state } = await startOAuth(app, "facebook");
    const res = await app.fetch(callbackGet("facebook", state));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { userId: string; accessToken: string } };
    expect(body.data.accessToken).toBeTruthy();

    const userId = identities.byEmail.get("fresh-fb@example.com");
    expect(userId).toBe(body.data.userId);
    // Locked-decision trust matrix: Facebook attests nothing → unverified.
    expect(identities.users.get(userId!)?.emailVerified).toBe(false);

    await app.stop();
  });

  test("control: authenticated linking WITH a session claims the existing account", async () => {
    const ownerEmail = "linkme@example.com";
    const { app, identities } = await bootHarness(
      mockFetch([
        jsonRoute((u) => u.href.startsWith("https://graph.facebook.com/v21.0/oauth/access_token"), {
          access_token: "fb-at",
        }),
        jsonRoute((u) => u.href.startsWith("https://graph.facebook.com/v21.0/me"), {
          id: "fb-linker",
          name: "Owner",
          email: ownerEmail,
        }),
      ]),
    );

    const owner = await signUpViaPassword(app, ownerEmail);

    const linkRes = await app.fetch(
      jsonPost(
        "/auth/oauth/facebook/link",
        { provider: "facebook" },
        { authorization: `Bearer ${owner.accessToken}` },
      ),
    );
    expect(linkRes.status).toBe(200);
    const linkBody = (await linkRes.json()) as { data: { authorizationUrl: string } };
    const state = new URL(linkBody.data.authorizationUrl).searchParams.get("state");
    expect(state).toBeTruthy();

    const res = await app.fetch(callbackGet("facebook", state!));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { userId: string } };
    expect(body.data.userId).toBe(owner.userId);
    expect(identities.byProvider.has("oauth:facebook:fb-linker")).toBe(true);

    await app.stop();
  });

  test("Discord dropping its verified flag yields emailVerified=false at the assertion boundary", async () => {
    const driver = openOAuthDiscord({
      fetch: mockFetch([
        jsonRoute((u) => u.href === "https://discord.com/api/users/@me", {
          id: "dc-42",
          username: "dave",
          email: "dave@example.com",
          // Nhost bug class: `verified` silently absent.
        }),
      ]),
    });
    const assertion = await driver.resolveAssertion({
      tokens: { accessToken: "tok", raw: {} },
      expectedIssuer: "https://discord.com",
      expectedAudience: "dc-client",
    });
    expect(assertion.email).toBe("dave@example.com");
    expect(assertion.emailVerified).toBe(false);
  });

  test("GitHub honors an explicit primary verified=true (positive trust control)", async () => {
    const driver = openOAuthGithub({
      fetch: mockFetch([
        jsonRoute((u) => u.href === "https://api.github.com/user", { id: 9001, login: "octocat" }),
        jsonRoute(
          (u) => u.href === "https://api.github.com/user/emails",
          [
            { email: "shadow@example.com", primary: false, verified: false },
            { email: "primary@example.com", primary: true, verified: true },
          ],
        ),
      ]),
    });
    const assertion = await driver.resolveAssertion({
      tokens: { accessToken: "tok", raw: {} },
      expectedIssuer: "https://github.com",
      expectedAudience: "gh-client",
    });
    expect(assertion.email).toBe("primary@example.com");
    expect(assertion.emailVerified).toBe(true);
  });

  test("parseEmailVerified collapses every falsy encoding to false (Apple 'false' string)", () => {
    expect(parseEmailVerified(true)).toBe(true);
    expect(parseEmailVerified("true")).toBe(true);
    expect(parseEmailVerified("1")).toBe(true);
    expect(parseEmailVerified("false")).toBe(false);
    expect(parseEmailVerified(false)).toBe(false);
    expect(parseEmailVerified(undefined)).toBe(false);
    expect(parseEmailVerified(null)).toBe(false);
    expect(parseEmailVerified(1)).toBe(false);
    expect(parseEmailVerified("")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* (b) Mix-up attacks (RFC 9700 §4.4 / RFC 9207)                       */
/* ------------------------------------------------------------------ */

describe("Mix-up attack defense", () => {
  test("state minted for google is dead on the github callback route", async () => {
    const calls = { urls: [] as string[] };
    const { app, identities } = await bootHarness(
      mockFetch(
        [
          jsonRoute((u) => u.href === "https://github.com/login/oauth/access_token", {
            access_token: "gh-at",
          }),
          jsonRoute((u) => u.href === "https://api.github.com/user", {
            id: 666,
            login: "evil",
          }),
          jsonRoute((u) => u.href === "https://api.github.com/user/emails", []),
        ],
        calls,
      ),
    );

    const { state } = await startOAuth(app, "google");

    const res = await app.fetch(callbackGet("github", state));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await readError(res)).reason).toBe("invalid_state");

    // Defense layer 1 fired before any provider call — no profile fetches,
    // no identity writes.
    expect(calls.urls.some((u) => u.includes("api.github.com"))).toBe(false);
    expect(identities.byProvider.has("oauth:github:666")).toBe(false);

    await app.stop();
  });

  test("OIDC ID token whose iss points at another provider is rejected at assertion", async () => {
    const { token, publicKeyJwk } = await signEs256IdToken({
      iss: "https://appleid.apple.com",
      aud: "g-client",
      sub: "evil-sub",
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const { app, identities } = await bootHarness(
      mockFetch([
        // Discovery for the google issuer (cached process-wide).
        jsonRoute((u) => u.href.endsWith("/.well-known/openid-configuration"), {
          authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
          token_endpoint: "https://oauth2.googleapis.com/token",
          jwks_uri: "https://accounts.google.com/oauth2/v3/certs",
        }),
        // Compromised/mixed-up token endpoint hands back the attacker token.
        jsonRoute((u) => u.href === "https://oauth2.googleapis.com/token", {
          access_token: "stolen-at",
          id_token: token,
          expires_in: 3600,
        }),
        // Attacker-held key published under google's JWKS URL: the signature
        // verifies, so rejection MUST come from issuer validation.
        jsonRoute((u) => u.href === "https://accounts.google.com/oauth2/v3/certs", {
          keys: [publicKeyJwk],
        }),
      ]),
    );

    const { state } = await startOAuth(app, "google");
    const res = await app.fetch(callbackGet("google", state));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await readError(res)).reason).toBe("issuer_mismatch");
    expect(identities.byProvider.has("oauth:google:evil-sub")).toBe(false);

    await app.stop();
  });

  test("verifyIdToken: equal iss passes, foreign iss fails (defense is not vacuous)", async () => {
    const good = await signEs256IdToken({
      iss: "https://accounts.google.com",
      aud: "unit-client",
      sub: "real-sub",
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const evil = await signEs256IdToken({
      iss: "https://appleid.apple.com",
      aud: "unit-client",
      sub: "real-sub",
      exp: Math.floor(Date.now() / 1000) + 300,
    });

    const claims = await verifyIdToken({
      idToken: good.token,
      jwksUri: "https://unit.test/good/certs",
      expectedIssuer: "https://accounts.google.com",
      expectedAudience: "unit-client",
      fetchFn: mockFetch([jsonRoute(() => true, { keys: [good.publicKeyJwk] })]),
    });
    expect(claims.subject).toBe("real-sub");
    expect(claims.issuer).toBe("https://accounts.google.com");

    let reason: string | undefined;
    try {
      await verifyIdToken({
        idToken: evil.token,
        jwksUri: "https://unit.test/bad/certs",
        expectedIssuer: "https://accounts.google.com",
        expectedAudience: "unit-client",
        fetchFn: mockFetch([jsonRoute(() => true, { keys: [evil.publicKeyJwk] })]),
      });
    } catch (err) {
      reason = (err as { reason?: string }).reason;
    }
    expect(reason).toBe("issuer_mismatch");
  });

  test("flow rows are single-use — a consumed state cannot be replayed", async () => {
    const { app } = await bootHarness(
      mockFetch([
        jsonRoute((u) => u.href.startsWith("https://graph.facebook.com/v21.0/oauth/access_token"), {
          access_token: "fb-at",
        }),
        jsonRoute((u) => u.href.startsWith("https://graph.facebook.com/v21.0/me"), {
          id: "fb-replay",
          name: "Replay",
          email: "replay@example.com",
        }),
      ]),
    );

    const { state } = await startOAuth(app, "facebook");
    const first = await app.fetch(callbackGet("facebook", state));
    expect(first.status).toBe(200);

    const replay = await app.fetch(callbackGet("facebook", state));
    expect(replay.status).toBeGreaterThanOrEqual(400);
    expect((await readError(replay)).reason).toBe("invalid_state");

    await app.stop();
  });
});
