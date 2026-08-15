/**
 * Part 4 verification: per-effect timing lives on EffectEntry via recordEffect /
 * gated — not RunTelemetry, not plugin hooks.
 */

import { describe, expect, test } from "bun:test";
import { createEffectLedger, recordEffect } from "./effects.ts";
import { createFxContext, type FxStubStoreHandle } from "./fx.ts";
import { HOOK_STAGES } from "./hooks.ts";
import { createRunTelemetry } from "./run-telemetry.ts";

/** Narrow stub handle for tests that exercise the in-memory store. */
function stub(fx: ReturnType<typeof createFxContext>["fx"], ref: string): FxStubStoreHandle {
  return fx.store(ref) as FxStubStoreHandle;
}

describe("per-effect timing (EffectEntry, not RunTelemetry / hooks)", () => {
  test("recordEffect writes timestamp + duration", async () => {
    const ledger = createEffectLedger();
    let t = 1000;
    await recordEffect(
      ledger,
      "read",
      "sql:notes",
      () => t++,
      async () => {
        t += 40;
        return "ok";
      },
    );
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]!.timestamp).toBe(1000);
    expect(ledger.entries[0]!.duration).toBe(41);
  });

  test("frozen clock still records high-res duration", async () => {
    const ledger = createEffectLedger();
    await recordEffect(
      ledger,
      "read",
      "sql:notes",
      () => 1_000,
      async () => {
        await Bun.sleep(2);
        return "ok";
      },
    );
    expect(ledger.entries[0]!.timestamp).toBe(1_000);
    expect(ledger.entries[0]!.duration).toBeGreaterThan(1);
  });

  test("gated fx.store / fx.emit / fx.send populate EffectEntry timing", async () => {
    const telemetry = createRunTelemetry();
    let t = 5000;
    const { fx, ledger } = createFxContext({
      flow: "timing.demo",
      effects: {
        writes: ["kv:cache"],
        emits: ["tick"],
        sends: ["hello"],
      },
      runTelemetry: telemetry,
      now: () => t++,
      channelRuntime: {
        send: async () => ({ ok: true as const }),
      } as never,
      signalRuntime: {
        emit: async () => {},
      } as never,
    });

    await stub(fx, "kv:cache").set("a", 1);
    await fx.emit("tick", {});
    await fx.send("hello", { to: "u1", data: {} });

    expect(ledger.entries.map((e) => e.kind)).toEqual(["write", "emit", "send"]);
    for (const e of ledger.entries) {
      expect(e.timestamp).toBeGreaterThan(0);
      expect(e.duration).toBeGreaterThanOrEqual(0);
    }
    // RunTelemetry stays aggregate-only — no effect span list.
    expect("effects" in telemetry).toBe(false);
    expect(telemetry.cacheHits).toBe(0);
  });

  test("plugin hook stages are pipeline stages, not fx wrap points", () => {
    expect([...HOOK_STAGES]).toEqual([
      "onRequest",
      "onParse",
      "onAuth",
      "beforeHandle",
      "afterHandle",
      "onError",
      "onResponse",
    ]);
    expect(HOOK_STAGES.includes("aroundFx" as never)).toBe(false);
  });
});
