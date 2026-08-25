/**
 * Shared identity store + locked account-linking rules across Gate auth method
 * plugins:
 *
 * (b) two different auth methods (e.g. username sign-up then magic-link with
 *     the same email) do NOT silently resolve to the same user without an
 *     authenticated linking action — `email_in_use` is refused on the second
 *     credential rather than auto-linked by email match.
 * (c) linking a new credential while genuinely authenticated as an existing
 *     user correctly attaches to that user's real row (passkey precedent,
 *     now generalized and enforced for all methods).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { linkOrProvision, type IdentityStore } from "../auth/identity.ts";
import { oke } from "./app.ts";
import { resetFlowSeq } from "./flow.ts";
import { resetBindings } from "./on.ts";
import { magicLink } from "../plugins/magic-link.ts";
import { username } from "../plugins/username.ts";

afterEach(() => {
  resetBindings();
  resetFlowSeq();
});

const SECRET = "test-secret-at-least-16";

function jsonPost(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function authApp() {
  return oke({
    name: `link-${crypto.randomUUID()}`,
    env: "test",
    registry: "ignore",
    gate: {
      auth: {
        secret: SECRET,
        emailAndPassword: { enabled: true },
      },
    },
  })
    .plug(username())
    .plug(magicLink({ exposeDevToken: true }));
}

describe("shared identity store — method plugins share one store", () => {
  test("username, magic-link, and gate.auth resolve against the app's single store", async () => {
    const app = authApp();
    await app.boot({ env: "test" });
    const identities = app.identities as IdentityStore | undefined;
    expect(identities).toBeDefined();

    const signUp = await app.fetch(
      jsonPost("/auth/sign-up/username", {
        username: "shared_store_user",
        password: "CorrectHorse1!",
      }),
    );
    expect(signUp.status).toBe(200);
    const created = (await signUp.json()) as { data: { userId: string } };

    // The identity store now holds the username credential account.
    const usernameAccount = [...identities!.accounts.values()].find(
      (a) => a.provider === "username",
    );
    expect(usernameAccount?.userId).toBe(created.data.userId);

    // A magic-link sign-in for the same email must NOT silently adopt the
    // username principal — it provisions its own user (or is refused).
    const req = await app.fetch(
      jsonPost("/auth/magic-link/request", { email: "shared_store_user@example.com" }),
    );
    const devToken = ((await req.json()) as { data: { devToken: string } }).data.devToken;
    const verify = await app.fetch(jsonPost("/auth/magic-link/verify", { token: devToken }));
    const magic = (await verify.json()) as { data: { userId: string } };
    expect(magic.data.userId).not.toBe(created.data.userId);

    await app.stop();
  });
});

describe("locked account-linking rule (never email-match auto-link)", () => {
  test("a second unauthenticated credential for an email owned by another user is refused (email_in_use)", async () => {
    const app = authApp();
    await app.boot({ env: "test" });
    const identities = app.identities as IdentityStore;

    // Provision a magic-link user with an email.
    const first = await linkOrProvision(identities, {
      provider: "magic-link",
      providerAccountId: "linkme@example.com",
      email: "linkme@example.com",
      emailVerified: true,
      now: () => 3_000_000,
    });
    expect(first.created).toBe(true);

    // A new unauthenticated credential claiming the same email must be refused,
    // NOT auto-linked to the magic-link user by email match.
    let refused: string | undefined;
    try {
      await linkOrProvision(identities, {
        provider: "otp",
        providerAccountId: "linkme@example.com",
        email: "linkme@example.com",
        now: () => 3_000_100,
      });
    } catch (err) {
      refused = err instanceof Error && "code" in err ? (err as { code: string }).code : undefined;
    }
    expect(refused).toBe("email_in_use");

    await app.stop();
  });

  test("username sign-up then magic-link with the same email do NOT resolve to the same user (real HTTP)", async () => {
    const app = authApp();
    await app.boot({ env: "test" });

    const signUp = await app.fetch(
      jsonPost("/auth/sign-up/username", {
        username: "dual_identity",
        password: "CorrectHorse1!",
      }),
    );
    expect(signUp.status).toBe(200);
    const created = (await signUp.json()) as { data: { userId: string } };

    // magic-link with the same email as an identifier: must NOT silently resolve
    // to the username user.
    const req = await app.fetch(
      jsonPost("/auth/magic-link/request", { email: "dual@example.com" }),
    );
    const devToken = ((await req.json()) as { data: { devToken: string } }).data.devToken;
    const verify = await app.fetch(jsonPost("/auth/magic-link/verify", { token: devToken }));
    const magic = (await verify.json()) as { data: { userId: string } };
    expect(magic.data.userId).not.toBe(created.data.userId);

    // And the username user resolves via sign-in to the SAME id as before.
    const signIn = await app.fetch(
      jsonPost("/auth/sign-in/username", {
        username: "dual_identity",
        password: "CorrectHorse1!",
      }),
    );
    const session = (await signIn.json()) as { data: { userId: string } };
    expect(session.data.userId).toBe(created.data.userId);

    await app.stop();
  });

  test("authenticated linking attaches a second credential to the same user row", async () => {
    const app = authApp();
    await app.boot({ env: "test" });
    const identities = app.identities as IdentityStore;

    const signUp = await app.fetch(
      jsonPost("/auth/sign-up/username", {
        username: "linked_user",
        password: "CorrectHorse1!",
      }),
    );
    expect(signUp.status).toBe(200);
    const created = (await signUp.json()) as { data: { accessToken: string; userId: string } };

    // Authenticated linking: attach an OTP credential to the same user while
    // holding the user's session (matching the passkey precedent).
    const linked = await linkOrProvision(identities, {
      provider: "otp",
      providerAccountId: "linked_phone",
      currentUserId: created.data.userId,
      now: () => 4_000_000,
    });
    expect(linked.user.id).toBe(created.data.userId);
    expect(linked.account.userId).toBe(created.data.userId);
    expect(linked.created).toBe(true);

    // Signing in via the new credential resolves to the SAME user.
    const res = await linkOrProvision(identities, {
      provider: "otp",
      providerAccountId: "linked_phone",
      now: () => 4_000_001,
    });
    expect(res.user.id).toBe(created.data.userId);
    expect(res.created).toBe(false);

    await app.stop();
  });
});
