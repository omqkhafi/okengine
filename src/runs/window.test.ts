import { describe, expect, test } from "bun:test";
import type { WideEvent } from "./types.ts";
import { evaluateSloBreaches, parseLatencyMs, windowStatsForFlow } from "./window.ts";

function ev(
  partial: Partial<WideEvent> & Pick<WideEvent, "id" | "durationMs" | "startedAt">,
): WideEvent {
  return {
    flow: "checkout.create",
    trigger: "http",
    plane: "user",
    gates: [],
    cache: "none",
    error: null,
    effects: [],
    logs: [],
    endedAt: partial.startedAt + partial.durationMs,
    dimensions: {},
    ...partial,
  };
}

describe("runs window stats", () => {
  test("parseLatencyMs", () => {
    expect(parseLatencyMs("200ms")).toBe(200);
    expect(parseLatencyMs("1s")).toBe(1000);
    expect(parseLatencyMs("bad")).toBeNull();
  });

  test("computes p95 and error rate", () => {
    const now = 10_000;
    const events = [
      ev({ id: "1", durationMs: 10, startedAt: now - 1000 }),
      ev({ id: "2", durationMs: 20, startedAt: now - 900 }),
      ev({ id: "3", durationMs: 30, startedAt: now - 800 }),
      ev({ id: "4", durationMs: 40, startedAt: now - 700 }),
      ev({
        id: "5",
        durationMs: 200,
        startedAt: now - 600,
        error: { code: "Timeout" },
      }),
    ];
    const stats = windowStatsForFlow(events, "checkout.create", now, 5 * 60_000);
    expect(stats.total).toBe(5);
    expect(stats.errors).toBe(1);
    expect(stats.errorRate).toBeCloseTo(0.2);
    expect(stats.p95Ms).toBe(200);
  });

  test("evaluateSloBreaches flags latency and availability", () => {
    const stats = windowStatsForFlow(
      [
        ev({ id: "1", durationMs: 500, startedAt: 9000, error: { code: "X" } }),
        ev({ id: "2", durationMs: 500, startedAt: 9100 }),
      ],
      "checkout.create",
      10_000,
      5_000,
    );
    const breaches = evaluateSloBreaches(stats, {
      availability: "99.9%",
      latency: { p95: "100ms" },
    });
    expect(breaches.some((b) => b.kind === "availability")).toBe(true);
    expect(breaches.some((b) => b.kind === "latency_p95")).toBe(true);
  });
});
