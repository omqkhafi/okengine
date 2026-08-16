/**
 * fx.ask stamps RunTelemetry.promptVersion and driver-supplied cost.
 * Token-only drivers must not invent a $0 WideEvent.cost.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ai, createAiRuntime } from "../elements/ai.ts";
import { collectWideEvent } from "../runs/collect.ts";
import { createEffectLedger } from "./effects.ts";
import { flow } from "./flow.ts";
import { createFx } from "./fx.ts";
import { createRunTelemetry } from "./run-telemetry.ts";
import { internal } from "./triggers.ts";

const triageFlow = flow("support.triage", {
  in: z.object({}),
  do: () => ({ ok: true }),
});

describe("fx.ask RunTelemetry", () => {
  test("stamps promptVersion and leaves cost 0 when the driver omits cost", async () => {
    const smart = ai.model("smart", { provider: "openai-compatible" });
    const triage = smart.prompt("ticket-triage", { version: 3 });
    const runtime = createAiRuntime({
      models: [smart],
      prompts: [triage],
      clients: {
        smart: {
          driverId: "openai-compatible",
          model: "gpt-test",
          async complete() {
            return {
              text: JSON.stringify({ ok: true }),
              raw: { ok: true },
              model: "gpt-test",
              driverId: "openai-compatible",
              usage: { inputTokens: 12, outputTokens: 7 },
            };
          },
        },
      },
    });
    const telemetry = createRunTelemetry();
    const ledger = createEffectLedger();
    const fx = createFx({
      flow: "support.triage",
      effects: { asks: ["ticket-triage"] },
      aiRuntime: runtime,
      runTelemetry: telemetry,
      ledger,
    });

    await fx.ask("ticket-triage", { subject: "x" });
    expect(telemetry.promptVersion).toBe(3);
    expect(telemetry.cost).toBe(0);
    expect(telemetry.inputTokens).toBe(12);
    expect(telemetry.outputTokens).toBe(7);

    const event = collectWideEvent({
      flow: triageFlow,
      trigger: internal,
      fx,
      ledger,
      telemetry,
      startedAt: 1_000,
      endedAt: 1_010,
    });
    expect(event.promptVersion).toBe(3);
    expect(event.cost).toBeUndefined();
    expect(event.dimensions.cost).toBeNull();
    expect(event.inputTokens).toBe(12);
    expect(event.outputTokens).toBe(7);
    expect(event.dimensions.input_tokens).toBe(12);
    expect(event.dimensions.output_tokens).toBe(7);
  });

  test("adds journaled cost only when the driver supplies a value greater than zero", async () => {
    const smart = ai.model("smart", { provider: "mock" });
    const triage = smart.prompt("ticket-triage", { version: 1 });
    const runtime = createAiRuntime({
      models: [smart],
      prompts: [triage],
      clients: {
        smart: {
          driverId: "mock",
          model: "mock",
          async complete() {
            return {
              text: JSON.stringify({ ok: true }),
              raw: { ok: true },
              model: "mock",
              driverId: "mock",
              usage: { inputTokens: 4, outputTokens: 2, cost: 0.42 },
            };
          },
        },
      },
    });
    const telemetry = createRunTelemetry();
    const fx = createFx({
      flow: "support.triage",
      effects: { asks: ["ticket-triage"] },
      aiRuntime: runtime,
      runTelemetry: telemetry,
    });

    await fx.ask("ticket-triage", { subject: "x" });
    expect(telemetry.promptVersion).toBe(1);
    expect(telemetry.cost).toBe(0.42);
    expect(telemetry.inputTokens).toBe(4);
    expect(telemetry.outputTokens).toBe(2);
  });
});
