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
import {
  createChannelInbox,
  openConsoleChannel,
  type ChannelDriver,
} from "../drivers/index.ts";
import {
  channel,
  createChannelRuntime,
  createConsentStore,
  FallbackTransport,
} from "./channel.ts";

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

function driverFromTransport(
  id: ChannelDriver["id"],
  transport: Transport,
): ChannelDriver {
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
    expect(result.attempts.some((a) => a.driverId === "smtp" && !a.ok)).toBe(
      true,
    );
    expect(result.attempts.some((a) => a.ok)).toBe(true);

    const receipts = runtime.receipts.forTemplate("booking-confirmed");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.attempts.length).toBeGreaterThanOrEqual(2);
    expect(receipts[0]!.status).toBe("fallback");
  });

  test("sently FallbackTransport is the same interface", async () => {
    const fb = new FallbackTransport([
      failingTransport("a"),
      okTransport("b"),
    ]);
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
    expect(runtime.receipts.all().at(-1)!.status).toBe(
      "suppressed/prior-bounce",
    );
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
      templates: [
        channel.template("hello", { medium: "email", locales: ["en", "ar"] }),
      ],
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
      templates: [
        channel.template("sms-otp", { medium: "sms" }),
      ],
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
