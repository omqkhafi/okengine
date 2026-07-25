/**
 * Per-plugin hook timing — real kernel instrumentation.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { flow } from "./flow.ts";
import {
  hookCostSummary,
  listHookCostSamples,
  resetHookCosts,
  tagHookWithPlugin,
} from "./hook-timing.ts";
import { runPipeline, type InvocationContext } from "./hooks.ts";
import { createFx } from "./fx.ts";
import { plugin } from "./plugin.ts";
import { applyPlugin, appPluginScope } from "./plug.ts";
import { createPluginRegistry } from "./registry.ts";

beforeEach(() => {
  resetHookCosts();
});

describe("hook timing", () => {
  test("runPipeline records wall-clock for tagged plugin hooks", async () => {
    const tagged = tagHookWithPlugin("audit", async () => {
      await Bun.sleep(2);
    });
    const ctx: InvocationContext = {
      trigger: { kind: "internal" },
      flow: flow({ name: "t", do: () => ({ ok: true }) }),
      input: undefined,
      params: {},
      state: {},
      decorations: {},
    };
    const fx = createFx({ flow: "t", effects: {} });
    await runPipeline(ctx, fx, { beforeHandle: [tagged] }, () => ({ ok: true }));

    const samples = listHookCostSamples();
    expect(samples.length).toBe(1);
    expect(samples[0]!.pluginId).toBe("audit");
    expect(samples[0]!.stage).toBe("beforeHandle");
    expect(samples[0]!.durationMs).toBeGreaterThanOrEqual(1);

    const summary = hookCostSummary("audit");
    expect(summary.count).toBe(1);
    expect(summary.meanMs).toBeGreaterThan(0);
  });

  test("registry tags hooks at plug time", async () => {
    const registry = createPluginRegistry();
    const p = plugin("metered", { version: "1.0.0" }).hook(
      "onRequest",
      async () => {
        await Bun.sleep(1);
      },
    );
    applyPlugin(registry, p, appPluginScope);
    const hooks = registry.hooksAt("app", undefined, "x");
    const ctx: InvocationContext = {
      trigger: { kind: "internal" },
      flow: flow({ name: "x", do: () => undefined }),
      input: undefined,
      params: {},
      state: {},
      decorations: {},
    };
    const fx = createFx({ flow: "x", effects: {} });
    await runPipeline(ctx, fx, hooks, () => undefined);
    expect(hookCostSummary("metered").count).toBe(1);
  });
});
