/**
 * Channel element acceptance:
 * - a fallback chain records both attempts
 * - delivery receipts are recorded
 * - consent / opt-out blocks send
 * - templates with i18n
 * - sently Transport interface (console / fake transports)
 */

import { describe, expect, test } from "bun:test";
import type { MailOptions, SendResult, Transport } from "sently";
import { createChannelInbox, openConsoleChannel, type ChannelDriver } from "../drivers/index.ts";
import type { SmsOtpTransport, SmsTransport } from "../drivers/channel-types.ts";
import { channel, createChannelRuntime, createConsentStore, FallbackTransport } from "./channel.ts";

/** Create a sently-compatible transport that always fails. */
function failingTransport(provider: string): Transport {
  return {
    provider,
    async send(_options: MailOptions): Promise<SendResult> {
      throw new Error(`${provider} down`);
    },
  };
}

/** Create a sently-compatible transport that succeeds. */
function okTransport(provider: string): Transport {
  return {
    provider,
    async send(options: MailOptions): Promise<SendResult> {
      const to = addressToString(options.to);
      const from = addressToString(options.from);
      return {
        messageId: `${provider}-msg`,
        accepted: [to],
        rejected: [],
        response: "ok",
        envelope: { from, to: [to] },
        provider,
      };
    },
  };
}

function addressToString(input: MailOptions["to"]): string {
  if (typeof input === "string") return input;
  if (Array.isArray(input)) return "batch";
  return input.address;
}

function driverFromTransport(id: ChannelDriver["id"], transport: Transport): ChannelDriver {
  return { id, transport };
}

describe("channel declaration", () => {
  test("template and medium binders", () => {
    const t = channel.template("otp-code", {
      medium: "any",
      locales: ["en", "ar"],
    });
    expect(t.name).toBe("otp-code");
    expect(t.medium).toBe("any");
    expect(t.locales).toEqual(["en", "ar"]);

    const mail = channel.email({ from: "noreply@oke.dev" });
    const order = mail.template("order-confirmed");
    expect(order.medium).toBe("email");
    expect(order.from).toBe("noreply@oke.dev");
  });
});

describe("fallback chain records both attempts", () => {
  test("default sender passes SMTP address validation (G13d fix)", async () => {
    const seen: Array<string | undefined> = [];
    const capturing = okTransport("smtp");
    const base = capturing.send.bind(capturing);
    const runtime = createChannelRuntime({
      templates: [channel.email().template("no-from-declared")],
      drivers: [
        driverFromTransport("smtp", {
          provider: "smtp",
          async send(options: MailOptions) {
            seen.push(addressToString(options.from));
            return base(options);
          },
        }),
      ],
      catalog: { "no-from-declared": { en: { subject: "s", text: "t" } } },
    });

    const result = await runtime.send("no-from-declared", { to: "user@example.com" });
    expect(result.ok).toBe(true);
    // Dotless `oke@localhost` was rejected by sently address validation.
    expect(seen[0]).toBe("oke@localhost.test");
  });

  test("concurrent sends serialize per transport — no wire interleave (G13d fix)", async () => {
    let inside = 0;
    let overlapped = false;
    const serialTransport: Transport = {
      provider: "smtp",
      async send(options: MailOptions): Promise<SendResult> {
        if (inside > 0) overlapped = true;
        inside += 1;
        await new Promise((r) => setTimeout(r, 5));
        inside -= 1;
        return okTransport("smtp").send(options);
      },
    };
    const runtime = createChannelRuntime({
      templates: [channel.email().template("bulk")],
      drivers: [driverFromTransport("smtp", serialTransport)],
      catalog: { bulk: { en: { subject: "s", text: "t" } } },
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        runtime.send("bulk", { to: `user${i}@example.com` }).then((r) => r.ok),
      ),
    );
    expect(results.every(Boolean)).toBe(true);
    expect(overlapped).toBe(false);
  });

  test("failed then succeeded — both attempts on the receipt", async () => {
    const inbox = createChannelInbox();
    const runtime = createChannelRuntime({
      templates: [
        channel.template("booking-confirmed", {
          medium: "email",
          locales: ["en"],
        }),
      ],
      drivers: [
        driverFromTransport("smtp", failingTransport("smtp")),
        driverFromTransport("resend", okTransport("resend")),
        openConsoleChannel({ inbox }),
      ],
      catalog: {
        "booking-confirmed": {
          en: {
            subject: "Booked {{id}}",
            text: "Hello {{name}}",
          },
        },
      },
    });

    const result = await runtime.send("booking-confirmed", {
      to: "user@example.com",
      data: { id: "B1", name: "Ali" },
      locale: "en",
    });

    expect(result.ok).toBe(true);
    expect(result.attempts.length).toBeGreaterThanOrEqual(2);
    expect(result.attempts.some((a) => a.driverId === "smtp" && !a.ok)).toBe(true);
    expect(result.attempts.some((a) => a.ok)).toBe(true);

    const receipts = runtime.receipts.forTemplate("booking-confirmed");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.attempts.length).toBeGreaterThanOrEqual(2);
    expect(receipts[0]!.status).toBe("fallback");
  });

  test("sently FallbackTransport is the same interface", async () => {
    const fb = new FallbackTransport([failingTransport("a"), okTransport("b")]);
    const r = await fb.send({
      from: "a@b.c",
      to: "d@e.f",
      subject: "hi",
      text: "x",
    });
    expect(r.provider).toBe("b");
  });
});

describe("consent and i18n", () => {
  test("opt-out blocks send and records receipt", async () => {
    const consent = createConsentStore();
    consent.optOut("user@example.com", "email");
    const runtime = createChannelRuntime({
      templates: [channel.template("news", { medium: "email" })],
      drivers: [openConsoleChannel()],
      consent,
    });
    const result = await runtime.send("news", { to: "user@example.com" });
    expect(result.ok).toBe(false);
    expect(runtime.receipts.all()[0]!.status).toBe("suppressed/opted-out");
  });

  test("prior hard bounce suppresses and records protective state", async () => {
    const runtime = createChannelRuntime({
      templates: [channel.template("news", { medium: "email" })],
      drivers: [openConsoleChannel()],
    });
    await runtime.send("news", { to: "bounce@example.com" });
    const sent = runtime.receipts.all()[0]!;
    runtime.ingestOutcome({
      messageId: sent.messageId!,
      state: "hard-bounce",
      to: "bounce@example.com",
      medium: "email",
    });
    const blocked = await runtime.send("news", { to: "bounce@example.com" });
    expect(blocked.ok).toBe(false);
    expect(runtime.receipts.all().at(-1)!.status).toBe("suppressed/prior-bounce");
  });

  test("locale chain is recorded on the receipt", async () => {
    const runtime = createChannelRuntime({
      templates: [channel.template("hello", { medium: "email" })],
      drivers: [openConsoleChannel()],
      defaultLocale: "en",
      catalog: { hello: { ar: { text: "أهلا" }, en: { text: "Hi" } } },
    });
    await runtime.send("hello", {
      to: "a@b.c",
      acceptLanguage: "ar-SA,en;q=0.8",
    });
    const receipt = runtime.receipts.all()[0]!;
    expect(receipt.locale).toBe("ar-SA");
    expect(receipt.localeChain).toEqual(["accept-language:ar-SA"]);
  });

  test("locale selects catalog body", async () => {
    const inbox = createChannelInbox();
    const runtime = createChannelRuntime({
      templates: [channel.template("hello", { medium: "email", locales: ["en", "ar"] })],
      drivers: [openConsoleChannel({ inbox })],
      catalog: {
        hello: {
          en: { subject: "Hi", text: "Hello" },
          ar: { subject: "مرحبا", text: "أهلا" },
        },
      },
    });
    await runtime.send("hello", { to: "a@b.c", locale: "ar" });
    expect(inbox.entries[0]!.subject).toBe("مرحبا");
    expect(inbox.entries[0]!.text).toBe("أهلا");
  });
});

describe("console driver", () => {
  test("dev inbox captures every medium", async () => {
    const inbox = createChannelInbox();
    const runtime = createChannelRuntime({
      templates: [channel.template("sms-otp", { medium: "sms" })],
      drivers: [openConsoleChannel({ inbox })],
      catalog: {
        "sms-otp": { en: { text: "code {{code}}" } },
      },
    });
    await runtime.send("sms-otp", {
      to: "+966500000000",
      data: { code: "1234" },
    });
    expect(inbox.entries).toHaveLength(1);
    expect(inbox.entries[0]!.medium).toBe("sms");
    expect(inbox.entries[0]!.text).toBe("code 1234");
  });
});

describe("provider-managed OTP (Taqnyat Verify)", () => {
  function taqnyatSmsDriver(): ChannelDriver {
    const otpTransport: SmsTransport & SmsOtpTransport = {
      provider: "taqnyat-sms",
      async send() {
        return { messageId: "m", to: "", status: "sent", response: "" };
      },
      async sendOtp(opts) {
        return {
          requestId: opts.requestId,
          to: opts.to,
          code: 5,
          response: "sent",
          provider: "taqnyat-sms",
        };
      },
      async verifyOtp(opts) {
        return {
          ok: true as const,
          code: opts.code === "0000" ? 13 : 10,
          message: "verified",
          response: "ok",
          provider: "taqnyat-sms",
        };
      },
    };
    return { id: "taqnyat", smsTransport: otpTransport };
  }

  test("sendOtp / verifyOtp dispatch to the taqnyat smsTransport", async () => {
    const runtime = createChannelRuntime({ drivers: [taqnyatSmsDriver()] });
    const sent = await runtime.sendOtp({ to: "+966500000000", requestId: "r1", lang: "en" });
    expect(sent.code).toBe(5);
    expect(sent.requestId).toBe("r1");
    const verified = await runtime.verifyOtp({
      to: "+966500000000",
      requestId: "r1",
      code: "6240",
    });
    expect(verified.ok).toBe(true);
    expect(verified.code).toBe(10);
  });

  test("throws loudly when no SMS driver is bound", async () => {
    const runtime = createChannelRuntime({});
    await expect(runtime.sendOtp({ to: "+966500000000", requestId: "r1" })).rejects.toThrow(
      "no SMS driver bound",
    );
  });

  test("throws loudly naming the driver when SMS driver lacks OTP support", async () => {
    const twilioLike: ChannelDriver = {
      id: "msegat",
      smsTransport: {
        provider: "msegat",
        async send() {
          return { messageId: "m", to: "", status: "sent", response: "" };
        },
      },
    };
    const runtime = createChannelRuntime({ drivers: [twilioLike] });
    await expect(runtime.sendOtp({ to: "+966500000000", requestId: "r1" })).rejects.toThrow(
      /SMS driver "msegat" does not support provider-managed OTP/,
    );
    await expect(
      runtime.verifyOtp({ to: "+966500000000", requestId: "r1", code: "1234" }),
    ).rejects.toThrow(/does not support provider-managed OTP/);
  });
});
