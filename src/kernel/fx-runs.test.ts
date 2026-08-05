import { describe, expect, test } from "bun:test";
import { createRunsRuntime } from "../runs/runtime.ts";
import type { WideEvent } from "../runs/types.ts";
import { createFxContext } from "./fx.ts";

describe("fx.runs", () => {
  test("window + checkSlo over bound runs runtime", async () => {
    const runs = createRunsRuntime({ driver: "memory" });
    await runs.open();
    const now = Date.now();
    const event: WideEvent = {
      id: "r1",
      flow: "checkout.create",
      trigger: "http",
      plane: "user",
      gates: [],
      cache: "none",
      error: null,
      effects: [],
      logs: [],
      durationMs: 250,
      startedAt: now - 1_000,
      endedAt: now,
      dimensions: {},
    };
    await runs.append(event);

    const { fx } = createFxContext({
      flow: "ops.slo-check",
      effects: { reads: ["runs"] },
      runsRuntime: runs,
      now: () => now,
    });

    const stats = await fx.runs.window("checkout.create", 5 * 60_000);
    expect(stats.total).toBe(1);
    expect(stats.p95Ms).toBe(250);

    const breaches = await fx.runs.checkSlo(
      "checkout.create",
      { latency: { p95: "100ms" } },
      5 * 60_000,
    );
    expect(breaches).toHaveLength(1);
    expect(breaches[0]!.kind).toBe("latency_p95");

    await runs.close();
  });
});
