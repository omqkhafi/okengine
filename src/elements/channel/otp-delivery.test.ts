/**
 * Tier-2 OTP cross-medium FallbackTransport delivery.
 */

import { describe, expect, test } from "bun:test";
import { openConsoleChannel } from "../../drivers/channel-console.ts";
import type { ChannelSendResult } from "../../drivers/channel-types.ts";
import { deliverOtpAcrossChannels, shouldFallbackOtpMedium } from "./otp-delivery.ts";

describe("otp-delivery", () => {
  test("shouldFallbackOtpMedium rejects invalid-address errors", () => {
    expect(shouldFallbackOtpMedium(new Error("invalid recipient address"))).toBe(false);
    expect(shouldFallbackOtpMedium(Object.assign(new Error("x"), { statusCode: 400 }))).toBe(false);
    expect(shouldFallbackOtpMedium(new Error("provider timeout"))).toBe(true);
  });

  test("FailoverTransport advances to next medium on provider error", async () => {
    let calls = 0;
    const send = async (template: string): Promise<ChannelSendResult> => {
      calls += 1;
      if (template === "auth-otp-sms") {
        return {
          ok: false,
          messageId: "x",
          driverId: "sms",
          attempts: [{ driverId: "sms", ok: false, error: "provider timeout", at: Date.now() }],
        };
      }
      return {
        ok: true,
        messageId: "e1",
        driverId: "email",
        attempts: [{ driverId: "email", ok: true, at: Date.now() }],
      };
    };

    const result = await deliverOtpAcrossChannels([openConsoleChannel()], send, {
      channels: ["sms", "email"],
      templates: { sms: "auth-otp-sms", email: "auth-otp-email" },
      phone: "+15551234567",
      email: "a@example.com",
      data: { otp: "123456" },
    });

    expect(result.ok).toBe(true);
    expect(result.channel).toBe("email");
    expect(calls).toBe(2);
    expect(result.attempts.some((a) => !a.ok)).toBe(true);
    expect(result.attempts.some((a) => a.ok)).toBe(true);
  });

  test("only: delivers a single channel (explicit resend)", async () => {
    const templates: string[] = [];
    const send = async (template: string): Promise<ChannelSendResult> => {
      templates.push(template);
      return {
        ok: true,
        messageId: "m",
        driverId: "console",
        attempts: [{ driverId: "console", ok: true, at: Date.now() }],
      };
    };

    const result = await deliverOtpAcrossChannels([openConsoleChannel()], send, {
      channels: ["sms", "email"],
      templates: { sms: "auth-otp-sms", email: "auth-otp-email" },
      phone: "+15551234567",
      email: "a@example.com",
      data: { otp: "123456" },
      only: "email",
    });

    expect(result.channel).toBe("email");
    expect(templates).toEqual(["auth-otp-email"]);
  });
});
