/**
 * Per-plugin hook cost ring buffer — real kernel instrumentation.
 *
 * {@link runPipeline} records samples when a hook carries a plugin id tag
 * (set at `.plug()` registration). The Console Plugins panel reads summaries;
 * this is not a UI estimate.
 */

import type { HookFn, HookStage } from "./hooks.ts";

/** Brand key stashed on wrapped hook functions. */
export const HOOK_PLUGIN_ID = Symbol.for("oke.hook.pluginId");

/** One timed hook invocation. */
export interface HookCostSample {
  readonly pluginId: string;
  readonly stage: HookStage;
  readonly durationMs: number;
  readonly at: number;
}

/** Aggregated cost for one plugin. */
export interface HookCostSummary {
  readonly pluginId: string;
  readonly count: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly lastMs: number | null;
  readonly byStage: Readonly<
    Partial<Record<HookStage, { readonly count: number; readonly meanMs: number }>>
  >;
}

const RING_SIZE = 256;
const samples: HookCostSample[] = [];
let writeAt = 0;
let filled = 0;

/**
 * Tag a hook so {@link runPipeline} attributes timing to `pluginId`.
 *
 * @param pluginId - Owning plugin Manifest key
 * @param fn - Hook body
 */
export function tagHookWithPlugin(pluginId: string, fn: HookFn): HookFn {
  const tagged = fn as HookFn & { [HOOK_PLUGIN_ID]?: string };
  tagged[HOOK_PLUGIN_ID] = pluginId;
  return tagged;
}

/**
 * Read the plugin id tag from a hook, if any.
 *
 * @param fn - Hook function
 */
export function pluginIdOfHook(fn: HookFn): string | undefined {
  return (fn as HookFn & { [HOOK_PLUGIN_ID]?: string })[HOOK_PLUGIN_ID];
}

/**
 * Record one timed sample into the ring buffer.
 *
 * @param pluginId - Owning plugin
 * @param stage - Pipeline stage
 * @param durationMs - Wall time
 * @param at - Epoch ms (default now)
 */
export function recordHookCost(
  pluginId: string,
  stage: HookStage,
  durationMs: number,
  at: number = Date.now(),
): void {
  const sample: HookCostSample = {
    pluginId,
    stage,
    durationMs,
    at,
  };
  if (filled < RING_SIZE) {
    samples.push(sample);
    filled++;
    writeAt = filled % RING_SIZE;
    return;
  }
  samples[writeAt] = sample;
  writeAt = (writeAt + 1) % RING_SIZE;
}

/**
 * All samples currently in the ring (oldest → newest).
 */
export function listHookCostSamples(): readonly HookCostSample[] {
  if (filled < RING_SIZE) return samples.slice();
  return [...samples.slice(writeAt), ...samples.slice(0, writeAt)];
}

/**
 * Aggregate cost summary for one plugin (or empty zeros when no samples).
 *
 * @param pluginId - Plugin id
 */
export function hookCostSummary(pluginId: string): HookCostSummary {
  const mine = listHookCostSamples().filter((s) => s.pluginId === pluginId);
  return summarize(pluginId, mine);
}

/**
 * Summaries for every plugin that has samples.
 */
export function allHookCostSummaries(): Readonly<Record<string, HookCostSummary>> {
  const byPlugin = new Map<string, HookCostSample[]>();
  for (const s of listHookCostSamples()) {
    const list = byPlugin.get(s.pluginId) ?? [];
    list.push(s);
    byPlugin.set(s.pluginId, list);
  }
  const out: Record<string, HookCostSummary> = {};
  for (const [id, list] of byPlugin) {
    out[id] = summarize(id, list);
  }
  return out;
}

/**
 * Clear the ring (tests).
 */
export function resetHookCosts(): void {
  samples.length = 0;
  writeAt = 0;
  filled = 0;
}

function summarize(
  pluginId: string,
  mine: readonly HookCostSample[],
): HookCostSummary {
  if (mine.length === 0) {
    return {
      pluginId,
      count: 0,
      meanMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      lastMs: null,
      byStage: {},
    };
  }
  const durations = mine.map((s) => s.durationMs).sort((a, b) => a - b);
  const sum = durations.reduce((a, b) => a + b, 0);
  const byStageAcc: Partial<
    Record<HookStage, { count: number; total: number }>
  > = {};
  for (const s of mine) {
    const cur = byStageAcc[s.stage] ?? { count: 0, total: 0 };
    cur.count++;
    cur.total += s.durationMs;
    byStageAcc[s.stage] = cur;
  }
  const byStage: Partial<
    Record<HookStage, { readonly count: number; readonly meanMs: number }>
  > = {};
  for (const [stage, acc] of Object.entries(byStageAcc) as Array<
    [HookStage, { count: number; total: number }]
  >) {
    byStage[stage] = {
      count: acc.count,
      meanMs: acc.total / acc.count,
    };
  }
  return {
    pluginId,
    count: mine.length,
    meanMs: sum / mine.length,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    lastMs: mine[mine.length - 1]!.durationMs,
    byStage,
  };
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1),
  );
  return sorted[idx]!;
}
