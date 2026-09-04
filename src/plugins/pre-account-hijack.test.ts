/**
 * CVE-2026-67327 — pre-account hijacking defense.
 *
 * Attacker parks an unverified email+password account; victim proves email via
 * magic-link or OTP; planted password must be invalidated and attacker sessions
 * revoked.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  completeVerifiedEmailSignIn,
  createIdentityStore,
  createUserWithPassword,
  type IdentityStore,
} from "../auth/identity.ts";
import { createSessionStore, issueSession } from "../auth/sessions.ts";
import { oke } from "../kernel/app.ts";
import { resetFlowSeq } from "../kernel/flow.ts";
import { resetBindings } from "../kernel/on.ts";
import { magicLink } from "./magic-link.ts";
import { otp } from "./otp.ts";

afterEach(() => {
  resetBindings();
  resetFlowSeq();
});

const SECRET = "test-secret-at-least-16";
const PLANTED_PASSWORD = "AttackerPlanted1!";

function jsonPost(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function emailAuthApp(plug: "magic-link" | "otp") {
  const app = oke({
    name: `pre-account-${crypto.randomUUID()}`,
    env: "test",
    registry: "ignore",
    gate: {
      auth: {
        secret: SECRET,
        emailAndPassword: { enabled: true },
      },
    },
  });
  if (plug === "magic-link") return app.plug(magicLink({ exposeDevToken: true }));
  return app.plug(otp({ mode: "app", channels: ["email"], exposeDevOtp: true }));
}

describe("completeVerifiedEmailSignIn — pre-account reclaim", () => {
  test("reclaims unverified password account: clears hash, revokes sessions, marks verified", async () => {
    const identities = createIdentityStore();
    const sessions = createSessionStore();
    const now = () => 5_000_000;

    const planted = await createUserWithPassword(identities, {
      email: "hijack@example.com",
      password: PLANTED_PASSWORD,
      now,
    });
    expect(planted.emailVerified).toBe(false);

    const attackerSession = await issueSession(
      sessions,
      { secret: SECRET, now },
      { id: planted.id, plane: "user", scopes: [] },
    );
    expect(attackerSession.session.revokedAt).toBeNull();

    const result = await completeVerifiedEmailSignIn(identities, sessions, {
      provider: "magic-link",
      providerAccountId: "hijack@example.com",
      email: "hijack@example.com",
      now,
    });

    expect(result.user.id).toBe(planted.id);
    expect(result.user.emailVerified).toBe(true);
    expect(result.credentialsCompromised).toBe(true);
    expect(result.created).toBe(true);

    const credential = [...identities.accounts.values()].find(
      (a) => a.provider === "credential" && a.userId === planted.id,
    );
    expect(credential?.passwordHash).toBeNull();
    expect(attackerSession.session.revokedAt).toBe(5_000_000);
  });

  test("verified owner re-auth attaches passwordless without purging password", async () => {
    const identities = createIdentityStore();
    const sessions = createSessionStore();
    const now = () => 6_000_000;

    const owner = await createUserWithPassword(identities, {
      email: "owner@example.com",
      password: "LegitimatePass1!",
      emailVerified: true,
      now,
    });
    const beforeHash = [...identities.accounts.values()].find(
      (a) => a.provider === "credential",
    )?.passwordHash;
    expect(beforeHash).toBeTruthy();

    const result = await completeVerifiedEmailSignIn(identities, sessions, {
      provider: "otp",
      providerAccountId: "owner@example.com",
      email: "owner@example.com",
      now,
    });

    expect(result.user.id).toBe(owner.id);
    expect(result.credentialsCompromised).toBe(false);
    const afterHash = [...identities.accounts.values()].find(
      (a) => a.provider === "credential",
    )?.passwordHash;
    expect(afterHash).toBe(beforeHash);
  });
});

describe("CVE-2026-67327 — HTTP pre-account hijack", () => {
  test("magic-link reclaim invalidates planted password", async () => {
    const app = emailAuthApp("magic-link");
    await app.boot({ env: "test" });
    const identities = app.identities as IdentityStore;

    const signUp = await app.fetch(
      jsonPost("/auth/sign-up/email", {
        email: "hijack@example.com",
        password: PLANTED_PASSWORD,
      }),
    );
    expect(signUp.status).toBe(200);
    const planted = (await signUp.json()) as { data: { userId: string; refreshToken: string } };
    expect(identities.users.get(planted.data.userId)?.emailVerified).toBe(false);

    const req = await app.fetch(jsonPost("/auth/magic-link/request", { email: "hijack@example.com" }));
    expect(req.status).toBe(200);
    const { data: challenge } = (await req.json()) as { data: { devToken: string } };

    const verify = await app.fetch(jsonPost("/auth/magic-link/verify", { token: challenge.devToken }));
    expect(verify.status).toBe(200);
    const session = (await verify.json()) as { data: { userId: string; accessToken: string } };
    expect(session.data.userId).toBe(planted.data.userId);
    expect(identities.users.get(planted.data.userId)?.emailVerified).toBe(true);

    const credential = [...identities.accounts.values()].find(
      (a) => a.provider === "credential" && a.userId === planted.data.userId,
    );
    expect(credential?.passwordHash).toBeNull();

    const signIn = await app.fetch(
      jsonPost("/auth/sign-in/email", {
        email: "hijack@example.com",
        password: PLANTED_PASSWORD,
      }),
    );
    const err = (await signIn.json()) as { error: { data?: { reason?: string } } };
    expect(err.error.data?.reason).toBe("invalid_credentials");

    const refresh = await app.fetch(
      jsonPost("/auth/refresh", { refreshToken: planted.data.refreshToken }),
    );
    expect(refresh.status).not.toBe(200);

    await app.stop();
  });

  test("email OTP reclaim invalidates planted password", async () => {
    const app = emailAuthApp("otp");
    await app.boot({ env: "test" });
    const identities = app.identities as IdentityStore;

    const signUp = await app.fetch(
      jsonPost("/auth/sign-up/email", {
        email: "otp-hijack@example.com",
        password: PLANTED_PASSWORD,
      }),
    );
    expect(signUp.status).toBe(200);
    const planted = (await signUp.json()) as { data: { userId: string } };

    const req = await app.fetch(
      jsonPost("/auth/otp/request", { email: "otp-hijack@example.com" }),
    );
    expect(req.status).toBe(200);
    const { data: challenge } = (await req.json()) as { data: { devOtp: string } };

    const verify = await app.fetch(
      jsonPost("/auth/otp/verify", {
        email: "otp-hijack@example.com",
        otp: challenge.devOtp,
      }),
    );
    expect(verify.status).toBe(200);
    const session = (await verify.json()) as { data: { userId: string } };
    expect(session.data.userId).toBe(planted.data.userId);
    expect(identities.users.get(planted.data.userId)?.emailVerified).toBe(true);

    const credential = [...identities.accounts.values()].find(
      (a) => a.provider === "credential" && a.userId === planted.data.userId,
    );
    expect(credential?.passwordHash).toBeNull();

    const signIn = await app.fetch(
      jsonPost("/auth/sign-in/email", {
        email: "otp-hijack@example.com",
        password: PLANTED_PASSWORD,
      }),
    );
    const err = (await signIn.json()) as { error: { data?: { reason?: string } } };
    expect(err.error.data?.reason).toBe("invalid_credentials");

    await app.stop();
  });
});
