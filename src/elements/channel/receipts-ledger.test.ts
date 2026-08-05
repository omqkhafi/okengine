/**
 * Receipt ledger adversarial proofs — status progression with Signal-like rigor:
 * sent → fallback → suppressed/* → ingestOutcome hard-bounce update →
 * blocked/invalid-address
 */

import { describe, expect, test } from "bun:test";
import { channel, createChannelRuntime, createConsentStore } from "../channel.ts";
import {
  countingOkTransport,
  driverFromTransport,
  failingTransport,
  okTransport,
} from "./test-helpers.ts";

describe("receipt ledger accuracy", () => {
  test("clean send records sent with messageId lookup", async () => {
    const runtime = createChannelRuntime({
      templates: [channel.template("hello", { medium: "email" })],
      drivers: [driverFromTransport("smtp", okTransport("smtp"))],
      catalog: { hello: { en: { subject: "Hi", text: "Hello" } } },
    });

    const result = await runtime.send("hello", { to: "a@b.c" });
    expect(result.ok).toBe(true);

    const receipt = runtime.receipts.forTemplate("hello")[0]!;
    expect(receipt.status).toBe("sent");
    expect(receipt.attempts).toHaveLength(1);
    expect(receipt.attempts[0]!.ok).toBe(true);
    expect(receipt.messageId).toBe(result.messageId);
    expect(runtime.receipts.byMessageId(result.messageId)?.id).toBe(receipt.id);
  });

  test("failover send records fallback with ordered attempts", async () => {
    const runtime = createChannelRuntime({
      templates: [channel.template("hello", { medium: "email" })],
      drivers: [
        driverFromTransport("smtp", failingTransport("smtp")),
        driverFromTransport("resend", okTransport("resend")),
      ],
    });

    await runtime.send("hello", { to: "a@b.c", via: ["smtp", "resend"] });
    const receipt = runtime.receipts.forTemplate("hello")[0]!;
    expect(receipt.status).toBe("fallback");
    expect(receipt.attempts.length).toBeGreaterThanOrEqual(2);
    expect(receipt.attempts[0]!.ok).toBe(false);
    expect(receipt.attempts.some((a) => a.ok)).toBe(true);
  });

  test("opt-out and prior-bounce leave empty attempts", async () => {
    const consent = createConsentStore();
    consent.optOut("out@example.com", "email");
    const { transport, calls } = countingOkTransport("smtp");
    const runtime = createChannelRuntime({
      templates: [channel.template("news", { medium: "email" })],
      drivers: [driverFromTransport("smtp", transport)],
      consent,
    });

    const opted = await runtime.send("news", { to: "out@example.com" });
    expect(opted.ok).toBe(false);
    expect(runtime.receipts.all()[0]!.status).toBe("suppressed/opted-out");
    expect(runtime.receipts.all()[0]!.attempts).toEqual([]);
    expect(calls.count).toBe(0);

    await runtime.send("news", { to: "bounce@example.com" });
    const sent = runtime.receipts.all().find((r) => r.to === "bounce@example.com")!;
    runtime.ingestOutcome({
      messageId: sent.messageId!,
      state: "hard-bounce",
      to: "bounce@example.com",
      medium: "email",
    });
    expect(runtime.receipts.byMessageId(sent.messageId!)!.status).toBe("hard-bounce");

    const blocked = await runtime.send("news", { to: "bounce@example.com" });
    expect(blocked.ok).toBe(false);
    const last = runtime.receipts.all().at(-1)!;
    expect(last.status).toBe("suppressed/prior-bounce");
    expect(last.attempts).toEqual([]);
  });

  test("invalid-address failure classifies as blocked/invalid-address", async () => {
    const runtime = createChannelRuntime({
      templates: [channel.template("hello", { medium: "email" })],
      drivers: [
        driverFromTransport(
          "smtp",
          failingTransport("smtp", new Error("invalid recipient address")),
        ),
      ],
    });

    const result = await runtime.send("hello", { to: "bad" });
    expect(result.ok).toBe(false);
    expect(runtime.receipts.forTemplate("hello")[0]!.status).toBe("blocked/invalid-address");
  });
});
