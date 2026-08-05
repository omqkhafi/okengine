/**
 * Hard-bounce auto-suppression adversarial proofs:
 * - ingestOutcome(hard-bounce) adds prior-bounce suppression
 * - subsequent send is blocked before the transport is called
 * - soft-bounce / complaint do not auto-suppress
 */

import { describe, expect, test } from "bun:test";
import { channel, createChannelRuntime } from "../channel.ts";
import { countingOkTransport, driverFromTransport } from "./test-helpers.ts";

describe("hard-bounce auto-suppression", () => {
  test("hard bounce auto-adds suppression and blocks the next send before transport", async () => {
    const { transport, calls } = countingOkTransport("smtp");
    const runtime = createChannelRuntime({
      templates: [channel.template("news", { medium: "email" })],
      drivers: [driverFromTransport("smtp", transport)],
      catalog: { news: { en: { subject: "Hi", text: "Hello" } } },
    });

    const first = await runtime.send("news", { to: "bounce@example.com" });
    expect(first.ok).toBe(true);
    expect(calls.count).toBe(1);

    const sent = runtime.receipts.all()[0]!;
    runtime.ingestOutcome({
      messageId: sent.messageId!,
      state: "hard-bounce",
      to: "bounce@example.com",
      medium: "email",
    });

    const listed = runtime.suppression.list();
    expect(
      listed.some((e) => e.subject === "bounce@example.com" && e.reason === "prior-bounce"),
    ).toBe(true);

    const blocked = await runtime.send("news", { to: "bounce@example.com" });
    expect(blocked.ok).toBe(false);
    expect(blocked.driverId).toBe("suppression");
    expect(blocked.attempts).toEqual([]);
    expect(calls.count).toBe(1);

    const last = runtime.receipts.all().at(-1)!;
    expect(last.status).toBe("suppressed/prior-bounce");
    expect(last.attempts).toEqual([]);
  });

  test("soft-bounce and complaint do not auto-add prior-bounce suppression", async () => {
    const { transport, calls } = countingOkTransport("smtp");
    const runtime = createChannelRuntime({
      templates: [channel.template("news", { medium: "email" })],
      drivers: [driverFromTransport("smtp", transport)],
    });

    await runtime.send("news", { to: "soft@example.com" });
    const softId = runtime.receipts.all()[0]!.messageId!;
    runtime.ingestOutcome({
      messageId: softId,
      state: "soft-bounce",
      to: "soft@example.com",
      medium: "email",
    });
    expect(runtime.suppression.list().some((e) => e.reason === "prior-bounce")).toBe(false);

    await runtime.send("news", { to: "complaint@example.com" });
    const complaintId = runtime.receipts
      .all()
      .find((r) => r.to === "complaint@example.com")!.messageId!;
    runtime.ingestOutcome({
      messageId: complaintId,
      state: "delivered-then-complained",
      to: "complaint@example.com",
      medium: "email",
    });
    expect(runtime.suppression.list().some((e) => e.reason === "prior-bounce")).toBe(false);

    const again = await runtime.send("news", { to: "soft@example.com" });
    expect(again.ok).toBe(true);
    expect(calls.count).toBeGreaterThanOrEqual(3);
  });
});
