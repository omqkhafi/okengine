/**
 * AI rate presets — gate.rate only, no parallel budgeting system.
 */

import { describe, expect, test } from "bun:test";
import { memoryKvDriver } from "../../drivers/index.ts";
import { createGateRuntime } from "../gate.ts";
import { AI_RATE_PRESETS, aiRateGate, createAiRateGates } from "./rate.ts";

describe("AI_RATE_PRESETS", () => {
  test("ask is stricter than embed; agent is strictest", () => {
    expect(AI_RATE_PRESETS.ask).toEqual({ max: 20, per: "1m", keyBy: "user" });
    expect(AI_RATE_PRESETS.agent).toEqual({ max: 10, per: "1m", keyBy: "user" });
    expect(AI_RATE_PRESETS.embed).toEqual({ max: 60, per: "1m", keyBy: "user" });
    expect(AI_RATE_PRESETS.agent.max).toBeLessThan(AI_RATE_PRESETS.ask.max);
    expect(AI_RATE_PRESETS.ask.max).toBeLessThan(AI_RATE_PRESETS.embed.max);
  });

  test("aiRateGate builds a real gate.rate decl", () => {
    const g = aiRateGate("ask");
    expect(g.kind).toBe("rate");
    expect(g.max).toBe(20);
    expect(g.per).toBe("1m");
    expect(g.keyBy).toBe("user");
    expect(g.name).toContain("20/1m");
  });

  test("createAiRateGates materializes three decls; deny after max", async () => {
    const kv = await memoryKvDriver.open({ name: "ai-rate" });
    const gates = createAiRateGates();
    expect(gates).toHaveLength(3);
    const runtime = createGateRuntime({ gates: [...gates], kv, now: () => 1_000 });
    const ask = gates[0]!;
    const ctx = {
      auth: { userId: "u1", scopes: new Set<string>() },
      operator: { id: null },
      meta: {},
    };
    for (let i = 0; i < ask.max; i++) {
      const ev = await runtime.check([ask.name], ctx);
      expect(ev.every((e) => e.allowed)).toBe(true);
    }
    const denied = await runtime.check([ask.name], ctx);
    expect(denied.some((e) => !e.allowed)).toBe(true);
    await kv.close();
  });

  test("public AI edge can override keyBy to ip", () => {
    const g = aiRateGate("ask", { keyBy: "ip", max: 5 });
    expect(g.keyBy).toBe("ip");
    expect(g.max).toBe(5);
  });
});
