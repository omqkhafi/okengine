/**
 * Unit tests for {@link collectWideEvent} duration resolution.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createEffectLedger } from "../kernel/effects.ts";
import { flow } from "../kernel/flow.ts";
import { createFx } from "../kernel/fx.ts";
import { internal } from "../kernel/triggers.ts";
import { createRunTelemetry } from "../kernel/run-telemetry.ts";
import { fail } from "../kernel/errors.ts";
import { collectWideEvent } from "./collect.ts";

const demo = flow("demo.fast", {
  in: z.object({}),
  do: () => ({ ok: true }),
});

function collect(over: {
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs?: number;
}) {
  return collectWideEvent({
    flow: demo,
    trigger: internal,
    fx: createFx({ flow: "demo.fast", effects: {} }),
    ledger: createEffectLedger(),
    telemetry: createRunTelemetry(),
    startedAt: over.startedAt,
    endedAt: over.endedAt,
    ...(over.durationMs !== undefined ? { durationMs: over.durationMs } : {}),
  });
}

describe("collectWideEvent failure message", () => {
  test("lifts fail(code, { message }) onto the run error", () => {
    const event = collectWideEvent({
      flow: demo,
      trigger: internal,
      fx: createFx({ flow: "demo.fast", effects: {} }),
      ledger: createEffectLedger(),
      telemetry: createRunTelemetry(),
      startedAt: 1_000,
      endedAt: 1_006,
      failure: fail("Unavailable", { message: "openai-compatible: fetch failed" }),
    });
    expect(event.error).toEqual({
      code: "Unavailable",
      message: "openai-compatible: fetch failed",
    });
  });
});

describe("collectWideEvent duration", () => {
  test("falls back to endedAt - startedAt when durationMs is omitted", () => {
    const event = collect({ startedAt: 1_000, endedAt: 1_012 });
    expect(event.durationMs).toBe(12);
    expect(event.dimensions.duration_ms).toBe(12);
  });

  test("keeps a high-res duration when the wall clock did not tick", () => {
    const event = collect({ startedAt: 1_000, endedAt: 1_000, durationMs: 0.37 });
    expect(event.durationMs).toBe(0.37);
    expect(event.dimensions.duration_ms).toBe(0.37);
  });
});
