/**
 * Exploit-proof security audit for the seven Gate auth method plugins.
 *
 * Real HTTP against a booted app — rate limits, gate posture, single-use tokens,
 * anonymous non-escalation, Channel delivery (email wired / phone deferred),
 * TOTP constant-time compare, and WebAuthn signature + origin verification.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { constantTimeEqual } from "../auth/constant-time.ts";
import { oke } from "../kernel/app.ts";
import { resetFlowSeq } from "../kernel/flow.ts";
import { resetBindings } from "../kernel/on.ts";
import { anonymous } from "./anonymous.ts";
import { magicLink } from "./magic-link.ts";
import { otp } from "./otp.ts";
import { createPasskeyStore, passkey } from "./passkey.ts";
import { b64urlEncode, buildAuthenticatorData, signWebAuthnAssertion } from "./passkey-webauthn.ts";
import { twoFactor, verifyTotp, createTwoFactorStore } from "./two-factor.ts";
import { username } from "./username.ts";

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

function fullAuthApp() {
  return oke({
    name: `auth-sec-${crypto.randomUUID()}`,
    env: "test",
    registry: "ignore",
    gate: {
      auth: {
        secret: SECRET,
        emailAndPassword: { enabled: true },
      },
      unguardedHttp: "deny",
    },
  })
    .plug(username())
    .plug(anonymous())
    .plug(magicLink({ exposeDevToken: true }))
    .plug(otp({ mode: "app", channels: ["email", "sms"], exposeDevOtp: true }))
    .plug(twoFactor())
    .plug(passkey({ origins: ["http://localhost"] }));
}

async function readError(res: Response): Promise<{ code?: string; reason?: string }> {
  const body = (await res.json()) as {
    error?: { code?: string; data?: { reason?: string } };
  };
  return { code: body.error?.code, reason: body.error?.data?.reason };
}

async function mintUsernameSession(
  app: ReturnType<typeof fullAuthApp>,
  usernameValue: string,
): Promise<{ accessToken: string; userId: string }> {
  const res = await app.fetch(
    jsonPost("/auth/sign-up/username", {
      username: usernameValue,
      password: "CorrectHorse1!",
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { accessToken: string; userId: string } };
  return body.data;
}

async function generatePasskeyKeypair(): Promise<{
  privateKey: CryptoKey;
  publicKeyB64: string;
}> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return { privateKey: pair.privateKey, publicKeyB64: b64urlEncode(spki) };
}

async function buildCeremony(opts: {
  type: "webauthn.create" | "webauthn.get";
  challenge: string;
  origin: string;
  rpId: string;
  privateKey: CryptoKey;
  signCount: number;
  /** Authenticator flags (default UP|UV = 0x05). */
  flags?: number;
}): Promise<{
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}> {
  const clientData = new TextEncoder().encode(
    JSON.stringify({
      type: opts.type,
      challenge: opts.challenge,
      origin: opts.origin,
    }),
  );
  const authData = await buildAuthenticatorData(opts.rpId, opts.signCount, opts.flags ?? 0x05);
  const sig = await signWebAuthnAssertion(opts.privateKey, authData, clientData);
  return {
    clientDataJSON: b64urlEncode(clientData),
    authenticatorData: b64urlEncode(authData),
    signature: b64urlEncode(sig),
  };
}

type PasskeyRegOpts = { challenge: string; sessionId: string; userId: string; rpId: string };
type PasskeyAuthOpts = { challenge: string; sessionId: string; rpId: string };

describe("auth methods — gate posture (zero-trust)", () => {
  test("every plugin HTTP binding declares gate posture; boot succeeds with deny", async () => {
    const app = fullAuthApp();
    const httpBindings = app.bindings.filter((b) => b.trigger.kind === "http");
    expect(httpBindings.length).toBeGreaterThan(10);
    for (const b of httpBindings) {
      const gates = (b.trigger as { gates: readonly unknown[] }).gates;
      expect(gates.length).toBeGreaterThan(0);
    }
    await app.boot({ env: "test" });
    await app.stop();
  });
});

describe("auth methods — rate limiting / enumeration", () => {
  test("OTP / magic-link / phone / passkey challenge endpoints rate-limit at 5/1m per IP", async () => {
    const app = fullAuthApp();
    await app.boot({ env: "test" });
    const ip = { "x-forwarded-for": "203.0.113.10" };

    const paths: Array<{ path: string; body: unknown }> = [
      { path: "/auth/magic-link/request", body: { email: "r@example.com" } },
      { path: "/auth/otp/request", body: { email: "r@example.com" } },
      { path: "/auth/passkey/authenticate/options", body: {} },
    ];

    for (const { path, body } of paths) {
      // Fresh IP per path so buckets do not share exhaustion across surfaces.
      const hdr = { ...ip, "x-forwarded-for": `203.0.113.${path.length}` };
      for (let i = 0; i < 5; i++) {
        const res = await app.fetch(jsonPost(path, body, hdr));
        expect(res.status).toBe(200);
      }
      const limited = await app.fetch(jsonPost(path, body, hdr));
      expect(limited.status).toBe(429);
      const err = await readError(limited);
      expect(err.code).toBe("RateLimited");
    }

    await app.stop();
  });

  test("username sign-in: unknown user and wrong password both invalid_credentials", async () => {
    const app = fullAuthApp();
    await app.boot({ env: "test" });
    await mintUsernameSession(app, "alice_enum");

    const missing = await app.fetch(
      jsonPost("/auth/sign-in/username", {
        username: "no_such_user",
        password: "CorrectHorse1!",
      }),
    );
    const wrong = await app.fetch(
      jsonPost("/auth/sign-in/username", {
        username: "alice_enum",
        password: "wrong-password",
      }),
    );
    const a = await readError(missing);
    const b = await readError(wrong);
    expect(a.reason).toBe("invalid_credentials");
    expect(b.reason).toBe("invalid_credentials");
    expect(a.code).toBe(b.code);

    await app.stop();
  });

  test("magic-link / email-otp request always ok (no email enumeration)", async () => {
    const app = fullAuthApp();
    await app.boot({ env: "test" });

    const a = await app.fetch(jsonPost("/auth/magic-link/request", { email: "a@example.com" }));
    const b = await app.fetch(jsonPost("/auth/magic-link/request", { email: "b@example.com" }));
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const aBody = (await a.json()) as { data: { ok: true } };
    const bBody = (await b.json()) as { data: { ok: true } };
    expect(aBody.data.ok).toBe(true);
    expect(bBody.data.ok).toBe(true);

    await app.stop();
  });
});

describe("auth methods — single-use OTP / token / backup codes", () => {
  test("magic-link token cannot be reused after verify", async () => {
    const app = fullAuthApp();
    await app.boot({ env: "test" });

    const req = await app.fetch(jsonPost("/auth/magic-link/request", { email: "ml@example.com" }));
    const { data } = (await req.json()) as { data: { devToken: string } };
    const first = await app.fetch(jsonPost("/auth/magic-link/verify", { token: data.devToken }));
    expect(first.status).toBe(200);
    const reuse = await app.fetch(jsonPost("/auth/magic-link/verify", { token: data.devToken }));
    expect(reuse.status).toBeGreaterThanOrEqual(400);
    expect((await readError(reuse)).reason).toBe("invalid_credentials");

    await app.stop();
  });

  test("email OTP cannot be reused after verify", async () => {
    const app = fullAuthApp();
    await app.boot({ env: "test" });

    const req = await app.fetch(jsonPost("/auth/otp/request", { email: "otp@example.com" }));
    const { data } = (await req.json()) as { data: { devOtp: string } };
    const first = await app.fetch(
      jsonPost("/auth/otp/verify", { email: "otp@example.com", otp: data.devOtp }),
    );
    expect(first.status).toBe(200);
    const reuse = await app.fetch(
      jsonPost("/auth/otp/verify", { email: "otp@example.com", otp: data.devOtp }),
    );
    expect((await readError(reuse)).reason).toBe("invalid_credentials");

    await app.stop();
  });

  test("phone OTP cannot be reused after verify", async () => {
    const app = fullAuthApp();
    await app.boot({ env: "test" });

    const req = await app.fetch(jsonPost("/auth/otp/request", { phone: "+15559876543" }));
    const { data } = (await req.json()) as { data: { devOtp: string } };
    const first = await app.fetch(
      jsonPost("/auth/otp/verify", { phone: "+15559876543", otp: data.devOtp }),
    );
    expect(first.status).toBe(200);
    const reuse = await app.fetch(
      jsonPost("/auth/otp/verify", { phone: "+15559876543", otp: data.devOtp }),
    );
    expect((await readError(reuse)).reason).toBe("invalid_credentials");

    await app.stop();
  });

  test("two-factor recovery code is single-use", async () => {
    const factors = createTwoFactorStore();
    const app = oke({
      name: `2fa-${crypto.randomUUID()}`,
      env: "test",
      registry: "ignore",
      gate: { auth: { secret: SECRET, emailAndPassword: { enabled: true } } },
    })
      .plug(username())
      .plug(twoFactor({ factors }));
    await app.boot({ env: "test" });

    const session = await mintUsernameSession(app, "twofa_user");
    const enable = await app.fetch(
      jsonPost("/auth/two-factor/enable", {}, { authorization: `Bearer ${session.accessToken}` }),
    );
    expect(enable.status).toBe(200);
    const enabled = (await enable.json()) as { data: { recoveryCodes: string[] } };
    const code = enabled.data.recoveryCodes[0]!;

    const challengeRes = await app.fetch(
      jsonPost("/auth/sign-in/username", {
        username: "twofa_user",
        password: "CorrectHorse1!",
      }),
    );
    expect(challengeRes.status).toBe(200);
    const challenge = (await challengeRes.json()) as {
      data: { twoFactorRequired: true; challengeId: string };
    };
    expect(challenge.data.twoFactorRequired).toBe(true);

    const first = await app.fetch(
      jsonPost("/auth/two-factor/verify", { challengeId: challenge.data.challengeId, code }),
    );
    expect(first.status).toBe(200);

    const challenge2 = await app.fetch(
      jsonPost("/auth/sign-in/username", {
        username: "twofa_user",
        password: "CorrectHorse1!",
      }),
    );
    const c2 = (await challenge2.json()) as { data: { challengeId: string } };
    const reuse = await app.fetch(
      jsonPost("/auth/two-factor/verify", { challengeId: c2.data.challengeId, code }),
    );
    expect((await readError(reuse)).reason).toBe("invalid_credentials");

    await app.stop();
  });

  test("passkey challenge cannot be reused after authenticate", async () => {
    const app = fullAuthApp();
    await app.boot({ env: "test" });
    const session = await mintUsernameSession(app, "pk_reuse");
    const keys = await generatePasskeyKeypair();

    const regOpts = await app.fetch(
      jsonPost(
        "/auth/passkey/register/options",
        {},
        { authorization: `Bearer ${session.accessToken}` },
      ),
    );
    const reg = (await regOpts.json()) as { data: PasskeyRegOpts };
    const regCeremony = await buildCeremony({
      type: "webauthn.create",
      challenge: reg.data.challenge,
      origin: "http://localhost",
      rpId: reg.data.rpId,
      privateKey: keys.privateKey,
      signCount: 0,
    });
    const credentialId = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    const registered = await app.fetch(
      jsonPost(
        "/auth/passkey/register",
        {
          credentialId,
          publicKey: keys.publicKeyB64,
          userId: reg.data.userId,
          challenge: reg.data.challenge,
          sessionId: reg.data.sessionId,
          ...regCeremony,
        },
        { authorization: `Bearer ${session.accessToken}` },
      ),
    );
    expect(registered.status).toBe(200);

    const authOpts = await app.fetch(jsonPost("/auth/passkey/authenticate/options", {}));
    const auth = (await authOpts.json()) as { data: PasskeyAuthOpts };
    const authCeremony = await buildCeremony({
      type: "webauthn.get",
      challenge: auth.data.challenge,
      origin: "http://localhost",
      rpId: auth.data.rpId,
      privateKey: keys.privateKey,
      signCount: 1,
    });
    const first = await app.fetch(
      jsonPost("/auth/passkey/authenticate", {
        credentialId,
        challenge: auth.data.challenge,
        sessionId: auth.data.sessionId,
        ...authCeremony,
      }),
    );
    expect(first.status).toBe(200);

    const reuse = await app.fetch(
      jsonPost("/auth/passkey/authenticate", {
        credentialId,
        challenge: auth.data.challenge,
        sessionId: auth.data.sessionId,
        ...authCeremony,
      }),
    );
    expect((await readError(reuse)).reason).toBe("invalid_credentials");

    await app.stop();
  });
});

describe("auth methods — anonymous non-escalation", () => {
  test("anonymous session cannot register a passkey for another userId", async () => {
    const app = fullAuthApp();
    await app.boot({ env: "test" });

    const anon = await app.fetch(jsonPost("/auth/sign-in/anonymous", {}));
    const anonBody = (await anon.json()) as { data: { accessToken: string; userId: string } };
    const victim = await mintUsernameSession(app, "victim_user");

    const opts = await app.fetch(
      jsonPost(
        "/auth/passkey/register/options",
        {},
        { authorization: `Bearer ${anonBody.data.accessToken}` },
      ),
    );
    expect(opts.status).toBe(200);
    const optBody = (await opts.json()) as { data: PasskeyRegOpts };
    expect(optBody.data.userId).toBe(anonBody.data.userId);

    const keys = await generatePasskeyKeypair();
    const ceremony = await buildCeremony({
      type: "webauthn.create",
      challenge: optBody.data.challenge,
      origin: "http://localhost",
      rpId: "localhost",
      privateKey: keys.privateKey,
      signCount: 0,
    });
    const escalate = await app.fetch(
      jsonPost(
        "/auth/passkey/register",
        {
          credentialId: b64urlEncode(crypto.getRandomValues(new Uint8Array(8))),
          publicKey: keys.publicKeyB64,
          userId: victim.userId,
          challenge: optBody.data.challenge,
          sessionId: optBody.data.sessionId,
          ...ceremony,
        },
        { authorization: `Bearer ${anonBody.data.accessToken}` },
      ),
    );
    expect(escalate.status).toBeGreaterThanOrEqual(400);
    expect((await readError(escalate)).reason).toBe("unauthenticated");

    // Username sign-up while holding anon Bearer creates a *new* principal — no silent link.
    const linked = await app.fetch(
      jsonPost("/auth/sign-up/username", {
        username: "fresh_from_anon",
        password: "CorrectHorse1!",
      }),
    );
    const linkedBody = (await linked.json()) as { data: { userId: string } };
    expect(linkedBody.data.userId).not.toBe(anonBody.data.userId);

    await app.stop();
  });
});

describe("auth methods — channel delivery", () => {
  test("magic uses fx.send; otp app mode uses fx.deliverOtp; exposeDev* stays off by default", async () => {
    resetBindings();
    resetFlowSeq();
    const app = oke({
      name: `delivery-${crypto.randomUUID()}`,
      env: "test",
      registry: "ignore",
      gate: { auth: { secret: SECRET, emailAndPassword: { enabled: true } } },
    })
      .plug(magicLink())
      .plug(otp({ mode: "app", channels: ["email", "sms"] }));
    await app.boot({ env: "test" });

    const ml = await app.fetch(jsonPost("/auth/magic-link/request", { email: "x@example.com" }));
    const mlBody = (await ml.json()) as { data: Record<string, unknown> };
    expect(mlBody.data.ok).toBe(true);
    expect(mlBody.data.devToken).toBeUndefined();

    const otpRes = await app.fetch(jsonPost("/auth/otp/request", { email: "x@example.com" }));
    const otpBody = (await otpRes.json()) as { data: Record<string, unknown> };
    expect(otpBody.data.ok).toBe(true);
    expect(otpBody.data.devOtp).toBeUndefined();

    const phone = await app.fetch(jsonPost("/auth/otp/request", { phone: "+15551112222" }));
    const phoneBody = (await phone.json()) as { data: Record<string, unknown> };
    expect(phoneBody.data.ok).toBe(true);
    expect(phoneBody.data.devOtp).toBeUndefined();

    const magicSrc = await Bun.file(new URL("./magic-link.ts", import.meta.url)).text();
    const otpSrc = await Bun.file(new URL("./otp.ts", import.meta.url)).text();
    expect(magicSrc).toMatch(/fx\.send\(/);
    expect(magicSrc).toMatch(/channel\./);
    expect(otpSrc).toMatch(/fx\s*\.\s*deliverOtp/);
    expect(otpSrc).toMatch(/fx\s*\.\s*sendOtp/);
    expect(otpSrc).toMatch(/fx\s*\.\s*verifyOtp/);
    expect(otpSrc).not.toMatch(/taqnyat-sms|sently\/transports/);

    await app.stop();
  });
});

describe("auth methods — TOTP constant-time compare (confirmed issue)", () => {
  test("verifyTotp accepts valid code and rejects wrong codes (no === short-circuit path)", async () => {
    // Source-level: the vulnerable `otp === code` pattern must be gone.
    const src = await Bun.file(new URL("./two-factor.ts", import.meta.url)).text();
    expect(src).not.toMatch(/otp\s*===\s*code/);
    expect(src).toContain("constantTimeEqual");
    expect(constantTimeEqual("123456", "123456")).toBe(true);
    expect(constantTimeEqual("123456", "123457")).toBe(false);

    const factors = createTwoFactorStore();
    const app = oke({
      name: `totp-${crypto.randomUUID()}`,
      env: "test",
      registry: "ignore",
      gate: { auth: { secret: SECRET, emailAndPassword: { enabled: true } } },
    })
      .plug(username())
      .plug(twoFactor({ factors }));
    await app.boot({ env: "test" });
    const session = await mintUsernameSession(app, "totp_user");
    const enable = await app.fetch(
      jsonPost("/auth/two-factor/enable", {}, { authorization: `Bearer ${session.accessToken}` }),
    );
    const { data } = (await enable.json()) as { data: { secret: string } };

    const t = Math.floor(Date.now() / 1000);
    const code = await generateTotpForTest(data.secret, t);
    expect(await verifyTotp(data.secret, code, t)).toBe(true);

    const challengeRes = await app.fetch(
      jsonPost("/auth/sign-in/username", {
        username: "totp_user",
        password: "CorrectHorse1!",
      }),
    );
    const challenge = (await challengeRes.json()) as {
      data: { challengeId: string; twoFactorRequired: true };
    };
    expect(challenge.data.twoFactorRequired).toBe(true);

    const ok = await app.fetch(
      jsonPost("/auth/two-factor/verify", {
        challengeId: challenge.data.challengeId,
        code,
      }),
    );
    expect(ok.status).toBe(200);

    // Wrong code of the same length — must fail (uses constant-time path).
    const challengeBad = await app.fetch(
      jsonPost("/auth/sign-in/username", {
        username: "totp_user",
        password: "CorrectHorse1!",
      }),
    );
    const badCh = (await challengeBad.json()) as { data: { challengeId: string } };
    const wrong = code === "000000" ? "000001" : "000000";
    const bad = await app.fetch(
      jsonPost("/auth/two-factor/verify", {
        challengeId: badCh.data.challengeId,
        code: wrong,
      }),
    );
    expect((await readError(bad)).reason).toBe("invalid_credentials");

    await app.stop();
  });
});

describe("auth methods — 2FA method lock (July–August 2026 bypass)", () => {
  test("TOTP enrollment mid email_otp challenge returns Forbidden", async () => {
    const factors = createTwoFactorStore();
    const app = oke({
      name: `2fa-lock-${crypto.randomUUID()}`,
      env: "test",
      registry: "ignore",
      gate: { auth: { secret: SECRET, emailAndPassword: { enabled: true } } },
    })
      .plug(username())
      .plug(otp({ mode: "app", channels: ["email"], exposeDevOtp: true }))
      .plug(twoFactor({ factors, exposeDevOtp: true }));
    await app.boot({ env: "test" });

    // First-factor session before 2FA is enabled (attacker may hold an old Bearer).
    const session = await mintUsernameSession(app, "lock_victim");

    // Seed email OTP as the configured second factor (method locked at challenge).
    factors.byUserId.set(session.userId, {
      userId: session.userId,
      method: "email_otp",
      secret: "",
      enabled: true,
      recoveryHashes: new Set(),
      createdAt: Date.now(),
      email: "lock_victim@example.com",
    });

    const signIn = await app.fetch(
      jsonPost("/auth/sign-in/username", {
        username: "lock_victim",
        password: "CorrectHorse1!",
      }),
    );
    expect(signIn.status).toBe(200);
    const challenge = (await signIn.json()) as {
      data: {
        twoFactorRequired: true;
        challengeId: string;
        method: string;
        accessToken?: string;
      };
    };
    expect(challenge.data.twoFactorRequired).toBe(true);
    expect(challenge.data.method).toBe("email_otp");
    expect(challenge.data.accessToken).toBeUndefined();

    // Mid-challenge: attempt TOTP QR enrollment without completing email OTP.
    const enroll = await app.fetch(
      jsonPost(
        "/auth/two-factor/enable",
        {},
        { authorization: `Bearer ${session.accessToken}` },
      ),
    );
    expect(enroll.status).toBeGreaterThanOrEqual(400);
    const err = await readError(enroll);
    expect(err.code).toBe("Forbidden");
    expect(err.reason).toBe("active_2fa_challenge");

    await app.stop();
  });

  test("email_otp challenge verify issues session; method change invalidates TOTP", async () => {
    const factors = createTwoFactorStore();
    const app = oke({
      name: `2fa-change-${crypto.randomUUID()}`,
      env: "test",
      registry: "ignore",
      gate: { auth: { secret: SECRET, emailAndPassword: { enabled: true } } },
    })
      .plug(username())
      .plug(twoFactor({ factors, exposeDevOtp: true }));
    await app.boot({ env: "test" });

    const session = await mintUsernameSession(app, "change_user");
    const enable = await app.fetch(
      jsonPost("/auth/two-factor/enable", {}, { authorization: `Bearer ${session.accessToken}` }),
    );
    expect(enable.status).toBe(200);
    const enabled = (await enable.json()) as { data: { secret: string } };
    const oldSecret = enabled.data.secret;

    // Step-up with TOTP, then change to email_otp.
    const t = Math.floor(Date.now() / 1000);
    const totpCode = await generateTotpForTest(oldSecret, t);
    const stepUp = await app.fetch(
      jsonPost(
        "/auth/two-factor/step-up",
        { code: totpCode, purpose: "change" },
        { authorization: `Bearer ${session.accessToken}` },
      ),
    );
    expect(stepUp.status).toBe(200);

    const change = await app.fetch(
      jsonPost(
        "/auth/two-factor/change-method",
        { method: "email_otp", email: "change_user@example.com" },
        { authorization: `Bearer ${session.accessToken}` },
      ),
    );
    expect(change.status).toBe(200);
    const changed = (await change.json()) as { data: { method: string; devOtp?: string } };
    expect(changed.data.method).toBe("email_otp");
    expect(changed.data.devOtp).toBeTruthy();

    const confirm = await app.fetch(
      jsonPost(
        "/auth/two-factor/confirm-change",
        { code: changed.data.devOtp },
        { authorization: `Bearer ${session.accessToken}` },
      ),
    );
    expect(confirm.status).toBe(200);
    expect(factors.byUserId.get(session.userId)?.method).toBe("email_otp");
    expect(factors.byUserId.get(session.userId)?.secret).toBe("");

    // Old TOTP no longer works for login.
    const signIn = await app.fetch(
      jsonPost("/auth/sign-in/username", {
        username: "change_user",
        password: "CorrectHorse1!",
      }),
    );
    const ch = (await signIn.json()) as {
      data: { challengeId: string; method: string; devOtp?: string };
    };
    expect(ch.data.method).toBe("email_otp");
    const badTotp = await app.fetch(
      jsonPost("/auth/two-factor/verify", {
        challengeId: ch.data.challengeId,
        code: await generateTotpForTest(oldSecret, Math.floor(Date.now() / 1000)),
      }),
    );
    expect((await readError(badTotp)).reason).toBe("invalid_credentials");

    const signIn2 = await app.fetch(
      jsonPost("/auth/sign-in/username", {
        username: "change_user",
        password: "CorrectHorse1!",
      }),
    );
    const ch2 = (await signIn2.json()) as {
      data: { challengeId: string; devOtp?: string };
    };
    const ok = await app.fetch(
      jsonPost("/auth/two-factor/verify", {
        challengeId: ch2.data.challengeId,
        code: ch2.data.devOtp,
      }),
    );
    expect(ok.status).toBe(200);

    await app.stop();
  });
});

/** Compute a valid 6-digit TOTP for tests (RFC 6238, SHA-1, 30s). */
async function generateTotpForTest(secretBase32: string, nowSec: number): Promise<string> {
  const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = secretBase32.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const key: number[] = [];
  for (const ch of cleaned) {
    const idx = B32.indexOf(ch);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      key.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const keyBytes = new Uint8Array(key);
  const counter = Math.floor(nowSec / 30);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer.slice(
      keyBytes.byteOffset,
      keyBytes.byteOffset + keyBytes.byteLength,
    ) as ArrayBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, msg));
  const offset = sig[sig.length - 1]! & 0x0f;
  const bin =
    ((sig[offset]! & 0x7f) << 24) |
    ((sig[offset + 1]! & 0xff) << 16) |
    ((sig[offset + 2]! & 0xff) << 8) |
    (sig[offset + 3]! & 0xff);
  return (bin % 1_000_000).toString().padStart(6, "0");
}

describe("auth methods — passkey signature + origin (confirmed issue)", () => {
  test("presence-only authenticate (credentialId alone) is rejected", async () => {
    const app = fullAuthApp();
    await app.boot({ env: "test" });
    const session = await mintUsernameSession(app, "pk_presence");
    const keys = await generatePasskeyKeypair();

    const regOpts = await app.fetch(
      jsonPost(
        "/auth/passkey/register/options",
        {},
        { authorization: `Bearer ${session.accessToken}` },
      ),
    );
    const reg = (await regOpts.json()) as { data: PasskeyRegOpts };
    const regCeremony = await buildCeremony({
      type: "webauthn.create",
      challenge: reg.data.challenge,
      origin: "http://localhost",
      rpId: reg.data.rpId,
      privateKey: keys.privateKey,
      signCount: 0,
    });
    const credentialId = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    expect(
      (
        await app.fetch(
          jsonPost(
            "/auth/passkey/register",
            {
              credentialId,
              publicKey: keys.publicKeyB64,
              userId: reg.data.userId,
              challenge: reg.data.challenge,
              sessionId: reg.data.sessionId,
              ...regCeremony,
            },
            { authorization: `Bearer ${session.accessToken}` },
          ),
        )
      ).status,
    ).toBe(200);

    // Pre-fix exploit shape: credentialId + userId, no signature / origin.
    const exploit = await app.fetch(
      jsonPost("/auth/passkey/authenticate", {
        credentialId,
        userId: session.userId,
      }),
    );
    expect(exploit.status).toBeGreaterThanOrEqual(400);

    await app.stop();
  });

  test("wrong origin is rejected; valid signature + origin issues a session", async () => {
    const app = fullAuthApp();
    await app.boot({ env: "test" });
    const session = await mintUsernameSession(app, "pk_origin");
    const keys = await generatePasskeyKeypair();

    const regOpts = await app.fetch(
      jsonPost(
        "/auth/passkey/register/options",
        {},
        { authorization: `Bearer ${session.accessToken}` },
      ),
    );
    const reg = (await regOpts.json()) as { data: PasskeyRegOpts };
    const regCeremony = await buildCeremony({
      type: "webauthn.create",
      challenge: reg.data.challenge,
      origin: "http://localhost",
      rpId: reg.data.rpId,
      privateKey: keys.privateKey,
      signCount: 0,
    });
    const credentialId = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    expect(
      (
        await app.fetch(
          jsonPost(
            "/auth/passkey/register",
            {
              credentialId,
              publicKey: keys.publicKeyB64,
              userId: reg.data.userId,
              challenge: reg.data.challenge,
              sessionId: reg.data.sessionId,
              ...regCeremony,
            },
            { authorization: `Bearer ${session.accessToken}` },
          ),
        )
      ).status,
    ).toBe(200);

    const authOpts = await app.fetch(jsonPost("/auth/passkey/authenticate/options", {}));
    const auth = (await authOpts.json()) as { data: PasskeyAuthOpts };

    const evil = await buildCeremony({
      type: "webauthn.get",
      challenge: auth.data.challenge,
      origin: "https://evil.example",
      rpId: auth.data.rpId,
      privateKey: keys.privateKey,
      signCount: 1,
    });
    const evilRes = await app.fetch(
      jsonPost("/auth/passkey/authenticate", {
        credentialId,
        challenge: auth.data.challenge,
        sessionId: auth.data.sessionId,
        ...evil,
      }),
    );
    expect((await readError(evilRes)).reason).toBe("invalid_origin");

    // Fresh challenge after failed attempt (previous challenge was consumed).
    const authOpts2 = await app.fetch(jsonPost("/auth/passkey/authenticate/options", {}));
    const auth2 = (await authOpts2.json()) as { data: PasskeyAuthOpts };
    const good = await buildCeremony({
      type: "webauthn.get",
      challenge: auth2.data.challenge,
      origin: "http://localhost",
      rpId: auth2.data.rpId,
      privateKey: keys.privateKey,
      signCount: 2,
    });
    const ok = await app.fetch(
      jsonPost("/auth/passkey/authenticate", {
        credentialId,
        challenge: auth2.data.challenge,
        sessionId: auth2.data.sessionId,
        ...good,
      }),
    );
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as { data: { accessToken: string; userId: string } };
    expect(okBody.data.accessToken).toBeTruthy();
    expect(okBody.data.userId).toBe(session.userId);

    await app.stop();
  });

  test("forged signature with wrong private key is rejected", async () => {
    const app = fullAuthApp();
    await app.boot({ env: "test" });
    const session = await mintUsernameSession(app, "pk_forge");
    const keys = await generatePasskeyKeypair();
    const attacker = await generatePasskeyKeypair();

    const regOpts = await app.fetch(
      jsonPost(
        "/auth/passkey/register/options",
        {},
        { authorization: `Bearer ${session.accessToken}` },
      ),
    );
    const reg = (await regOpts.json()) as { data: PasskeyRegOpts };
    const regCeremony = await buildCeremony({
      type: "webauthn.create",
      challenge: reg.data.challenge,
      origin: "http://localhost",
      rpId: reg.data.rpId,
      privateKey: keys.privateKey,
      signCount: 0,
    });
    const credentialId = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    await app.fetch(
      jsonPost(
        "/auth/passkey/register",
        {
          credentialId,
          publicKey: keys.publicKeyB64,
          userId: reg.data.userId,
          challenge: reg.data.challenge,
          sessionId: reg.data.sessionId,
          ...regCeremony,
        },
        { authorization: `Bearer ${session.accessToken}` },
      ),
    );

    const authOpts = await app.fetch(jsonPost("/auth/passkey/authenticate/options", {}));
    const auth = (await authOpts.json()) as { data: PasskeyAuthOpts };
    const forged = await buildCeremony({
      type: "webauthn.get",
      challenge: auth.data.challenge,
      origin: "http://localhost",
      rpId: auth.data.rpId,
      privateKey: attacker.privateKey,
      signCount: 1,
    });
    const res = await app.fetch(
      jsonPost("/auth/passkey/authenticate", {
        credentialId,
        challenge: auth.data.challenge,
        sessionId: auth.data.sessionId,
        ...forged,
      }),
    );
    expect((await readError(res)).reason).toBe("invalid_credentials");

    await app.stop();
  });
});

describe("auth methods — passkey hardening (UV · session · counter · type)", () => {
  async function registerPasskey(
    app: ReturnType<typeof fullAuthApp>,
    accessToken: string,
    keys: { privateKey: CryptoKey; publicKeyB64: string },
  ): Promise<{ credentialId: string }> {
    const regOpts = await app.fetch(
      jsonPost("/auth/passkey/register/options", {}, { authorization: `Bearer ${accessToken}` }),
    );
    const reg = (await regOpts.json()) as { data: PasskeyRegOpts };
    const regCeremony = await buildCeremony({
      type: "webauthn.create",
      challenge: reg.data.challenge,
      origin: "http://localhost",
      rpId: reg.data.rpId,
      privateKey: keys.privateKey,
      signCount: 0,
    });
    const credentialId = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    const registered = await app.fetch(
      jsonPost(
        "/auth/passkey/register",
        {
          credentialId,
          publicKey: keys.publicKeyB64,
          userId: reg.data.userId,
          challenge: reg.data.challenge,
          sessionId: reg.data.sessionId,
          ...regCeremony,
        },
        { authorization: `Bearer ${accessToken}` },
      ),
    );
    expect(registered.status).toBe(200);
    return { credentialId };
  }

  test("UV=false assertion is rejected with user_not_verified", async () => {
    const app = fullAuthApp();
    await app.boot({ env: "test" });
    const session = await mintUsernameSession(app, "pk_uv");
    const keys = await generatePasskeyKeypair();
    const { credentialId } = await registerPasskey(app, session.accessToken, keys);

    const authOpts = await app.fetch(jsonPost("/auth/passkey/authenticate/options", {}));
    const auth = (await authOpts.json()) as { data: PasskeyAuthOpts };
    const ceremony = await buildCeremony({
      type: "webauthn.get",
      challenge: auth.data.challenge,
      origin: "http://localhost",
      rpId: auth.data.rpId,
      privateKey: keys.privateKey,
      signCount: 1,
      flags: 0x01, // UP only — no UV
    });
    const res = await app.fetch(
      jsonPost("/auth/passkey/authenticate", {
        credentialId,
        challenge: auth.data.challenge,
        sessionId: auth.data.sessionId,
        ...ceremony,
      }),
    );
    expect((await readError(res)).reason).toBe("user_not_verified");

    await app.stop();
  });

  test("wrong clientDataJSON.type is rejected on authenticate and register", async () => {
    const app = fullAuthApp();
    await app.boot({ env: "test" });
    const session = await mintUsernameSession(app, "pk_type");
    const keys = await generatePasskeyKeypair();
    const { credentialId } = await registerPasskey(app, session.accessToken, keys);

    const authOpts = await app.fetch(jsonPost("/auth/passkey/authenticate/options", {}));
    const auth = (await authOpts.json()) as { data: PasskeyAuthOpts };
    const wrongType = await buildCeremony({
      type: "webauthn.create", // must be webauthn.get
      challenge: auth.data.challenge,
      origin: "http://localhost",
      rpId: auth.data.rpId,
      privateKey: keys.privateKey,
      signCount: 1,
    });
    const authRes = await app.fetch(
      jsonPost("/auth/passkey/authenticate", {
        credentialId,
        challenge: auth.data.challenge,
        sessionId: auth.data.sessionId,
        ...wrongType,
      }),
    );
    expect((await readError(authRes)).reason).toBe("invalid_credentials");

    const regOpts = await app.fetch(
      jsonPost(
        "/auth/passkey/register/options",
        {},
        { authorization: `Bearer ${session.accessToken}` },
      ),
    );
    const reg = (await regOpts.json()) as { data: PasskeyRegOpts };
    const wrongRegType = await buildCeremony({
      type: "webauthn.get", // must be webauthn.create
      challenge: reg.data.challenge,
      origin: "http://localhost",
      rpId: reg.data.rpId,
      privateKey: keys.privateKey,
      signCount: 0,
    });
    const regRes = await app.fetch(
      jsonPost(
        "/auth/passkey/register",
        {
          credentialId: b64urlEncode(crypto.getRandomValues(new Uint8Array(8))),
          publicKey: keys.publicKeyB64,
          userId: reg.data.userId,
          challenge: reg.data.challenge,
          sessionId: reg.data.sessionId,
          ...wrongRegType,
        },
        { authorization: `Bearer ${session.accessToken}` },
      ),
    );
    expect((await readError(regRes)).reason).toBe("invalid_credentials");

    await app.stop();
  });

  test("sessionId mismatch is rejected; matching session + challenge succeeds", async () => {
    const app = fullAuthApp();
    await app.boot({ env: "test" });
    const session = await mintUsernameSession(app, "pk_sid");
    const keys = await generatePasskeyKeypair();
    const { credentialId } = await registerPasskey(app, session.accessToken, keys);

    const authOpts = await app.fetch(jsonPost("/auth/passkey/authenticate/options", {}));
    const auth = (await authOpts.json()) as { data: PasskeyAuthOpts };
    const ceremony = await buildCeremony({
      type: "webauthn.get",
      challenge: auth.data.challenge,
      origin: "http://localhost",
      rpId: auth.data.rpId,
      privateKey: keys.privateKey,
      signCount: 1,
    });
    const mismatch = await app.fetch(
      jsonPost("/auth/passkey/authenticate", {
        credentialId,
        challenge: auth.data.challenge,
        sessionId: crypto.randomUUID(),
        ...ceremony,
      }),
    );
    expect((await readError(mismatch)).reason).toBe("invalid_credentials");

    const authOpts2 = await app.fetch(jsonPost("/auth/passkey/authenticate/options", {}));
    const auth2 = (await authOpts2.json()) as { data: PasskeyAuthOpts };
    const good = await buildCeremony({
      type: "webauthn.get",
      challenge: auth2.data.challenge,
      origin: "http://localhost",
      rpId: auth2.data.rpId,
      privateKey: keys.privateKey,
      signCount: 1,
    });
    const ok = await app.fetch(
      jsonPost("/auth/passkey/authenticate", {
        credentialId,
        challenge: auth2.data.challenge,
        sessionId: auth2.data.sessionId,
        ...good,
      }),
    );
    expect(ok.status).toBe(200);

    await app.stop();
  });

  test("expired challenge (>5m) is rejected", async () => {
    let now = 1_700_000_000_000;
    const app = oke({
      name: `auth-sec-ttl-${crypto.randomUUID()}`,
      env: "test",
      registry: "ignore",
      gate: {
        auth: {
          secret: SECRET,
          emailAndPassword: { enabled: true },
          now: () => now,
        },
        unguardedHttp: "deny",
      },
    })
      .plug(username({ now: () => now }))
      .plug(passkey({ origins: ["http://localhost"], now: () => now }));
    await app.boot({ env: "test" });

    const session = await mintUsernameSession(app, "pk_ttl");
    const keys = await generatePasskeyKeypair();

    const regOpts = await app.fetch(
      jsonPost(
        "/auth/passkey/register/options",
        {},
        { authorization: `Bearer ${session.accessToken}` },
      ),
    );
    const reg = (await regOpts.json()) as { data: PasskeyRegOpts };
    const regCeremony = await buildCeremony({
      type: "webauthn.create",
      challenge: reg.data.challenge,
      origin: "http://localhost",
      rpId: reg.data.rpId,
      privateKey: keys.privateKey,
      signCount: 0,
    });
    const credentialId = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    expect(
      (
        await app.fetch(
          jsonPost(
            "/auth/passkey/register",
            {
              credentialId,
              publicKey: keys.publicKeyB64,
              userId: reg.data.userId,
              challenge: reg.data.challenge,
              sessionId: reg.data.sessionId,
              ...regCeremony,
            },
            { authorization: `Bearer ${session.accessToken}` },
          ),
        )
      ).status,
    ).toBe(200);

    const authOpts = await app.fetch(jsonPost("/auth/passkey/authenticate/options", {}));
    const auth = (await authOpts.json()) as { data: PasskeyAuthOpts };
    now += 5 * 60 * 1000 + 1;
    const ceremony = await buildCeremony({
      type: "webauthn.get",
      challenge: auth.data.challenge,
      origin: "http://localhost",
      rpId: auth.data.rpId,
      privateKey: keys.privateKey,
      signCount: 1,
    });
    const res = await app.fetch(
      jsonPost("/auth/passkey/authenticate", {
        credentialId,
        challenge: auth.data.challenge,
        sessionId: auth.data.sessionId,
        ...ceremony,
      }),
    );
    expect((await readError(res)).reason).toBe("invalid_credentials");

    await app.stop();
  });

  test("non-increasing signCount deletes credential and returns reregister_required", async () => {
    const passkeys = createPasskeyStore();
    const app = oke({
      name: `auth-sec-clone-${crypto.randomUUID()}`,
      env: "test",
      registry: "ignore",
      gate: {
        auth: {
          secret: SECRET,
          emailAndPassword: { enabled: true },
        },
        unguardedHttp: "deny",
      },
    })
      .plug(username())
      .plug(passkey({ origins: ["http://localhost"], passkeys }));
    await app.boot({ env: "test" });

    const session = await mintUsernameSession(app, "pk_clone");
    const keys = await generatePasskeyKeypair();
    const { credentialId } = await registerPasskey(app, session.accessToken, keys);

    const authOpts1 = await app.fetch(jsonPost("/auth/passkey/authenticate/options", {}));
    const auth1 = (await authOpts1.json()) as { data: PasskeyAuthOpts };
    const c1 = await buildCeremony({
      type: "webauthn.get",
      challenge: auth1.data.challenge,
      origin: "http://localhost",
      rpId: auth1.data.rpId,
      privateKey: keys.privateKey,
      signCount: 1,
    });
    expect(
      (
        await app.fetch(
          jsonPost("/auth/passkey/authenticate", {
            credentialId,
            challenge: auth1.data.challenge,
            sessionId: auth1.data.sessionId,
            ...c1,
          }),
        )
      ).status,
    ).toBe(200);
    expect(passkeys.byCredentialId.get(credentialId)?.counter).toBe(1);

    const authOpts2 = await app.fetch(jsonPost("/auth/passkey/authenticate/options", {}));
    const auth2 = (await authOpts2.json()) as { data: PasskeyAuthOpts };
    const c2 = await buildCeremony({
      type: "webauthn.get",
      challenge: auth2.data.challenge,
      origin: "http://localhost",
      rpId: auth2.data.rpId,
      privateKey: keys.privateKey,
      signCount: 1,
    });
    const clone = await app.fetch(
      jsonPost("/auth/passkey/authenticate", {
        credentialId,
        challenge: auth2.data.challenge,
        sessionId: auth2.data.sessionId,
        ...c2,
      }),
    );
    expect((await readError(clone)).reason).toBe("reregister_required");
    expect(passkeys.byCredentialId.has(credentialId)).toBe(false);

    await app.stop();
  });
});
