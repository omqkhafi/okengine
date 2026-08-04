/**
 * otp() plugin — plug-time fail-loud, Tier 2 resend / sealed lifetime, Tier 1 boot.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  createVerificationStore,
  findActiveVerification,
  type VerificationStore,
} from "../auth/verification.ts";
import { openConsoleChannel } from "../drivers/channel-console.ts";
import type { ChannelDriver, SmsOtpTransport, SmsTransport } from "../drivers/channel-types.ts";
import { oke } from "../kernel/app.ts";
import { resetFlowSeq } from "../kernel/flow.ts";
import { resetBindings } from "../kernel/on.ts";
import { otp } from "./otp.ts";

afterEach(() => {
  resetBindings();
  resetFlowSeq();
});

const SECRET = "test-secret-at-least-16";

function jsonPost(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockOtpSmsDriver(): ChannelDriver {
  const codes = new Map<string, string>();
  const otpTransport: SmsTransport & SmsOtpTransport = {
    provider: "mock-otp",
    async send() {
      return { messageId: "m", to: "+", status: "ok", response: "ok" };
    },
    async sendOtp(opts) {
      codes.set(opts.requestId, "pending");
      return {
        requestId: opts.requestId,
        to: opts.to,
        code: 5,
        response: "ok",
        provider: "mock-otp",
      };
    },
    async verifyOtp(opts) {
      if (!codes.has(opts.requestId)) throw new Error("unknown request");
      return { ok: true as const, code: 10, message: "ok", response: "ok", provider: "mock-otp" };
    },
  };
  return {
    id: "taqnyat",
    smsTransport: otpTransport,
    channel: {
      provider: "mock-otp",
      mediums: ["sms"],
      async send() {
        return {
          ok: true,
          messageId: "m",
          driverId: "mock-otp",
          attempts: [{ driverId: "mock-otp", ok: true, at: Date.now() }],
        };
      },
    },
  };
}

describe("otp() plug-time fail-loud", () => {
  test("missing tier throws", () => {
    expect(() => otp({} as never)).toThrow(/tier is required/);
  });

  test("tier 1 with channels throws", () => {
    expect(() => otp({ tier: 1, channels: ["sms"] } as never)).toThrow(/channels are forbidden/);
  });

  test("tier 1 with exposeDevOtp throws", () => {
    expect(() => otp({ tier: 1, exposeDevOtp: true } as never)).toThrow(
      /exposeDevOtp is forbidden/,
    );
  });

  test("tier 2 without channels throws", () => {
    expect(() => otp({ tier: 2 } as never)).toThrow(/channels is required/);
  });
});

describe("otp() Tier 1 boot", () => {
  test("fails loud without Verify-capable SMS driver", async () => {
    const app = oke({
      name: `otp-t1-${crypto.randomUUID()}`,
      env: "test",
      registry: "ignore",
      gate: { auth: { secret: SECRET } },
    }).plug(otp({ tier: 1 }));
    await expect(app.boot({ env: "test" })).rejects.toThrow(/tier: 1/);
  });

  test("boots when Verify-capable SMS driver is bound", async () => {
    const app = oke({
      name: `otp-t1-ok-${crypto.randomUUID()}`,
      env: "test",
      registry: "ignore",
      gate: { auth: { secret: SECRET } },
      channel: { drivers: [mockOtpSmsDriver()] },
    }).plug(otp({ tier: 1 }));
    await app.boot({ env: "test" });
    const res = await app.fetch(jsonPost("/auth/otp/request", { phone: "+15551234567" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { ok: true; devOtp?: string } };
    expect(body.data.ok).toBe(true);
    expect(body.data.devOtp).toBeUndefined();
    expect(app.router.match("POST", "/auth/otp/resend")).toBeFalsy();
    await app.stop();
  });
});

describe("otp() Tier 2 resend + sealed lifetime", () => {
  test("cross-channel resend keeps same code; cooldown then verify wipes seal", async () => {
    let now = 1_000_000;
    const verifications: VerificationStore = createVerificationStore();
    const app = oke({
      name: `otp-t2-${crypto.randomUUID()}`,
      env: "test",
      registry: "ignore",
      gate: { auth: { secret: SECRET } },
      channel: { drivers: [openConsoleChannel()] },
      fx: { now: () => now },
    }).plug(
      otp({
        tier: 2,
        channels: ["sms", "email"],
        exposeDevOtp: true,
        resendCooldownMs: 60_000,
        verifications,
        now: () => now,
        secret: SECRET,
      }),
    );
    await app.boot({ env: "test" });

    const req = await app.fetch(
      jsonPost("/auth/otp/request", {
        phone: "+15551234567",
        email: "a@example.com",
      }),
    );
    expect(req.status).toBe(200);
    const requested = (await req.json()) as {
      data: { ok: true; devOtp: string; channel: string };
    };
    expect(requested.data.devOtp).toMatch(/^\d{6}$/);
    const code = requested.data.devOtp;
    const expiresAt = findActiveVerification(verifications, "otp:+15551234567", now)?.expiresAt;
    expect(expiresAt).toBeDefined();
    expect(findActiveVerification(verifications, "otp:+15551234567", now)?.sealedOtp).toBeTruthy();

    const cool = await app.fetch(
      jsonPost("/auth/otp/resend", {
        phone: "+15551234567",
        email: "a@example.com",
        channel: "email",
      }),
    );
    const coolBody = (await cool.json()) as { error?: { data?: { reason?: string } } };
    expect(coolBody.error?.data?.reason).toBe("resend_cooldown");

    now += 60_001;
    const resent = await app.fetch(
      jsonPost("/auth/otp/resend", {
        phone: "+15551234567",
        email: "a@example.com",
        channel: "email",
      }),
    );
    expect(resent.status).toBe(200);
    const resentBody = (await resent.json()) as { data: { channel: string; devOtp?: string } };
    expect(resentBody.data.channel).toBe("email");
    expect(resentBody.data.devOtp).toBe(code);
    expect(findActiveVerification(verifications, "otp:+15551234567", now)?.expiresAt).toBe(
      expiresAt,
    );

    const verify = await app.fetch(
      jsonPost("/auth/otp/verify", { phone: "+15551234567", otp: code }),
    );
    expect(verify.status).toBe(200);

    const row = [...verifications.rows.values()].find((r) => r.identifier === "otp:+15551234567");
    expect(row?.sealedOtp).toBeNull();
    expect(row?.consumedAt).toBeTruthy();

    await app.stop();
  });

  test("expired challenge wipes sealed OTP", async () => {
    let now = 1_000_000;
    const verifications = createVerificationStore();
    const app = oke({
      name: `otp-ttl-${crypto.randomUUID()}`,
      env: "test",
      registry: "ignore",
      gate: { auth: { secret: SECRET } },
      fx: { now: () => now },
    }).plug(
      otp({
        tier: 2,
        channels: ["email"],
        exposeDevOtp: true,
        ttlMs: 1_000,
        verifications,
        now: () => now,
        secret: SECRET,
      }),
    );
    await app.boot({ env: "test" });

    await app.fetch(jsonPost("/auth/otp/request", { email: "ttl@example.com" }));
    const active = findActiveVerification(verifications, "otp:ttl@example.com", now);
    expect(active?.sealedOtp).toBeTruthy();

    now += 2_000;
    expect(findActiveVerification(verifications, "otp:ttl@example.com", now)).toBeUndefined();
    const row = [...verifications.rows.values()].find(
      (r) => r.identifier === "otp:ttl@example.com",
    );
    expect(row?.sealedOtp).toBeNull();

    await app.stop();
  });
});
