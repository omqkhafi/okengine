/**
 * Same-medium FallbackTransport adversarial proofs:
 * - provider error advances the chain and delivers via secondary
 * - permanent client errors (status 400 / invalid address) do NOT failover
 *   (aligned with shouldFallbackOtpMedium)
 */

import { describe, expect, test } from "bun:test";
import { channel, createChannelRuntime } from "../channel.ts";
import { countingOkTransport, driverFromTransport, failingTransport } from "./test-helpers.ts";

describe("FallbackTransport same-medium failover", () => {
  test("provider error advances to secondary and delivers", async () => {
    const secondary = countingOkTransport("resend");
    const runtime = createChannelRuntime({
      templates: [channel.template("booking", { medium: "email" })],
      drivers: [
        driverFromTransport(
          "smtp",
          failingTransport(
            "smtp",
            Object.assign(new Error("provider timeout"), { statusCode: 500 }),
          ),
        ),
        driverFromTransport("resend", secondary.transport),
      ],
      catalog: { booking: { en: { subject: "Booked", text: "ok" } } },
    });

    const result = await runtime.send("booking", {
      to: "user@example.com",
      via: ["smtp", "resend"],
    });

    expect(result.ok).toBe(true);
    expect(secondary.calls.count).toBe(1);
    expect(result.attempts.some((a) => a.driverId === "smtp" && !a.ok)).toBe(true);
    expect(result.attempts.some((a) => a.ok)).toBe(true);

    const receipt = runtime.receipts.forTemplate("booking")[0]!;
    expect(receipt.status).toBe("fallback");
    expect(receipt.attempts.length).toBeGreaterThanOrEqual(2);
  });

  test("statusCode 400 does not advance to secondary", async () => {
    const secondary = countingOkTransport("resend");
    const runtime = createChannelRuntime({
      templates: [channel.template("booking", { medium: "email" })],
      drivers: [
        driverFromTransport(
          "smtp",
          failingTransport("smtp", Object.assign(new Error("bad request"), { statusCode: 400 })),
        ),
        driverFromTransport("resend", secondary.transport),
      ],
    });

    const result = await runtime.send("booking", {
      to: "user@example.com",
      via: ["smtp", "resend"],
    });

    expect(secondary.calls.count).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.attempts.every((a) => a.driverId !== "resend")).toBe(true);
  });

  test("invalid recipient address does not advance to secondary", async () => {
    const secondary = countingOkTransport("resend");
    const runtime = createChannelRuntime({
      templates: [channel.template("booking", { medium: "email" })],
      drivers: [
        driverFromTransport(
          "smtp",
          failingTransport("smtp", new Error("invalid recipient address")),
        ),
        driverFromTransport("resend", secondary.transport),
      ],
    });

    const result = await runtime.send("booking", {
      to: "not-an-email",
      via: ["smtp", "resend"],
    });

    expect(secondary.calls.count).toBe(0);
    expect(result.ok).toBe(false);
    const receipt = runtime.receipts.forTemplate("booking")[0]!;
    expect(receipt.status).toBe("blocked/invalid-address");
  });
});
