/**
 * Resolve plugin `.needs(dep)` at boot — fail loud when unmet.
 *
 * Tokens are either:
 * - another plugged plugin name (e.g. `"auth"`)
 * - an element / driver id (e.g. `"store.sql"`, `"postgres"`)
 */

import type { PluginCapabilities } from "./plugin.ts";

/** Known element / facet dependency tokens. */
export const ELEMENT_NEED_TOKENS = [
  "store.sql",
  "store.kv",
  "store.files",
  "store.index",
  "signal",
  "clock",
  "gate",
  "vault",
  "channel",
  "ai",
  "flow",
] as const;

/** One unmet `.needs()` dependency. */
export interface PluginNeedGap {
  /** Plugin that declared the need. */
  readonly plugin: string;
  /** Unmet dependency token. */
  readonly need: string;
}

/**
 * Thrown when installed plugins declare unmet `.needs()` dependencies.
 */
export class PluginNeedsError extends Error {
  readonly gaps: readonly PluginNeedGap[];

  constructor(gaps: readonly PluginNeedGap[]) {
    const lines = gaps.map((g) => `  - ${g.plugin} needs "${g.need}"`);
    super(
      `plugin boot failed — ${gaps.length} unmet .needs() dependenc${gaps.length === 1 ? "y" : "ies"}:\n${lines.join("\n")}`,
    );
    this.name = "PluginNeedsError";
    this.gaps = gaps;
  }
}

/** Context for resolving whether a need token is available. */
export interface PluginNeedsContext {
  /** Installed plugin names. */
  readonly pluginNames: ReadonlySet<string>;
  /**
   * Available element / driver tokens (e.g. `store.sql`, `postgres`).
   * Built from boot options, declared drivers, and element needs.
   */
  readonly available: ReadonlySet<string>;
}

/**
 * Collect unmet needs across all plugin capabilities.
 *
 * @param capabilities - Registry capability map
 * @param ctx - Available plugins + element/driver tokens
 */
export function collectUnmetPluginNeeds(
  capabilities: Readonly<Record<string, PluginCapabilities>>,
  ctx: PluginNeedsContext,
): PluginNeedGap[] {
  const gaps: PluginNeedGap[] = [];
  for (const caps of Object.values(capabilities)) {
    for (const need of caps.needs) {
      if (ctx.pluginNames.has(need) || ctx.available.has(need)) continue;
      gaps.push({ plugin: caps.name, need });
    }
  }
  return gaps;
}

/**
 * Assert every plugin `.needs()` is satisfied. Throws {@link PluginNeedsError}.
 *
 * @param capabilities - Registry capability map
 * @param ctx - Available plugins + element/driver tokens
 */
export function assertPluginNeeds(
  capabilities: Readonly<Record<string, PluginCapabilities>>,
  ctx: PluginNeedsContext,
): void {
  const gaps = collectUnmetPluginNeeds(capabilities, ctx);
  if (gaps.length > 0) throw new PluginNeedsError(gaps);
}

/**
 * Build the available token set from boot-time signals.
 *
 * @param input - Element/driver presence flags and declared driver ids
 */
export function buildAvailableNeedTokens(input: {
  readonly elements?: {
    readonly storeSql?: boolean;
    readonly storeKv?: boolean;
    readonly storeFiles?: boolean;
    readonly storeIndex?: boolean;
    readonly signal?: boolean;
    readonly clock?: boolean;
    readonly gate?: boolean;
    readonly vault?: boolean;
    readonly channel?: boolean;
    readonly ai?: boolean;
  };
  readonly driverIds?: readonly string[];
}): Set<string> {
  const available = new Set<string>();
  const e = input.elements ?? {};
  if (e.storeSql) available.add("store.sql");
  if (e.storeKv) available.add("store.kv");
  if (e.storeFiles) available.add("store.files");
  if (e.storeIndex) available.add("store.index");
  if (e.signal) available.add("signal");
  if (e.clock) available.add("clock");
  if (e.gate) available.add("gate");
  if (e.vault) available.add("vault");
  if (e.channel) available.add("channel");
  if (e.ai) available.add("ai");
  for (const id of input.driverIds ?? []) available.add(id);
  return available;
}
