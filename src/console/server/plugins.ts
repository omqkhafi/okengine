/**
 * Console Plugins panel projection (console §9.15).
 *
 * Read-only: origin × state, declares vs intercepts (with measured hook cost),
 * supply-chain signals, capability diff via doctor merge-base `diffManifest`.
 * Never installs — hands a `bun add …` command for community packages.
 */

import {
  allHookCostSummaries,
  type HookCostSummary,
} from "../../kernel/hook-timing.ts";
import type { PluginRegistry } from "../../kernel/registry.ts";
import type {
  Manifest,
  ManifestChange,
  Plugin,
  PluginOrigin,
} from "../../manifest/types.ts";
import {
  CORE_PLUGINS,
  isCorePluginOn,
  type PluginConfigProbe,
} from "../../plugins/catalogue.ts";
import type {
  PackageJsonProbe,
  SupplyChainSignals,
} from "../../plugins/supply-chain.ts";
import type { ScanSourceFile } from "../../plugins/node-import-scan.ts";

/** Plugin on/off — derived, never a config flag. */
export type PluginState = "on" | "off";

/** Attachment scope summary. */
export interface PluginScopeView {
  readonly kind: "app" | "unit" | "flow";
  readonly name?: string;
}

/** One intercept stage with measured cost. */
export interface PluginInterceptView {
  readonly stage: string;
  readonly meanMs: number | null;
  readonly count: number;
}

/** Capability diff line (from `diffManifest`, not recomputed). */
export interface PluginCapabilityChange {
  readonly path: string;
  readonly category: string;
  readonly kind: string;
  readonly summary: string;
}

/** One plugin row in the panel. */
export interface ConsolePluginRow {
  readonly id: string;
  readonly origin: PluginOrigin;
  readonly state: PluginState;
  readonly version: string | null;
  readonly summary: string | null;
  readonly scopes: readonly PluginScopeView[];
  readonly declares: readonly string[];
  readonly intercepts: readonly PluginInterceptView[];
  readonly hookCost: {
    readonly count: number;
    readonly meanMs: number;
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly lastMs: number | null;
  } | null;
  readonly supplyChain: SupplyChainSignals;
  readonly capabilityDiff: readonly PluginCapabilityChange[];
  /** Copyable install command — community only; null otherwise. */
  readonly installCommand: string | null;
  /** How to turn a CORE plugin on (code / config) — never a Console action. */
  readonly enableHint: string | null;
  readonly packageName: string | null;
}

/** Full Plugins panel projection. */
export interface ConsolePluginsList {
  readonly plugins: readonly ConsolePluginRow[];
  /** Derivation rule documented for operators / four-applications alignment. */
  readonly stateDerivation: string;
}

/** Options for {@link projectPluginsList}. */
export interface ProjectPluginsOptions {
  readonly manifest: Manifest | null;
  readonly config?: PluginConfigProbe | null;
  readonly registry?: PluginRegistry | null;
  readonly cwd: string;
  readonly now: () => number;
  /** Injected capability-diff changes keyed by plugin id (tests). */
  readonly capabilityDiffByPlugin?: Readonly<
    Record<string, readonly ManifestChange[]>
  >;
  /** When true, run doctor merge-base diff (default true). */
  readonly resolveCapabilityDiff?: boolean;
  /** Injected hook cost summaries (tests). */
  readonly hookCosts?: Readonly<Record<string, HookCostSummary>>;
  /** Per-plugin sources for oxc scan. */
  readonly sourcesByPlugin?: Readonly<
    Record<string, readonly ScanSourceFile[]>
  >;
  /** Per-plugin package.json injections (tests). */
  readonly packageJsonByPlugin?: Readonly<
    Record<string, PackageJsonProbe | null>
  >;
  /** Per-plugin boot conflicts. */
  readonly bootConflictsByPlugin?: Readonly<Record<string, readonly string[]>>;
  /** Skip npm network. */
  readonly fetchNpm?: boolean;
  /** Use sync supply-chain (tests). */
  readonly syncSupplyChain?: boolean;
}

/** Documented state derivation (panel + four-applications). */
export const PLUGIN_STATE_DERIVATION = [
  "CORE auth/console/rate-limit: on iff `.plug()`-ed (Manifest/registry).",
  "CORE tenancy: on iff oke.config.ts has `tenancy: {…}` (or Manifest.tenancy).",
  "CORE privacy: on iff oke.config.ts has `privacy` or top-level `runs.redact`.",
  "local/community: listed only when present via `.plug()` / Manifest.plugins.",
].join(" ");

/**
 * Project the Plugins panel from Manifest, config, registry, and real signals.
 *
 * @param options - Inputs
 */
export async function projectPluginsList(
  options: ProjectPluginsOptions,
): Promise<ConsolePluginsList> {
  const plugged = collectPlugged(options.manifest, options.registry);
  const costs = options.hookCosts ?? allHookCostSummaries();
  const capabilityAll =
    options.capabilityDiffByPlugin ??
    (options.resolveCapabilityDiff === false
      ? {}
      : await loadCapabilityDiffByPlugin(options.cwd, options.manifest));

  const rows: ConsolePluginRow[] = [];

  for (const spec of CORE_PLUGINS) {
    const on = isCorePluginOn(
      spec.id,
      options.manifest,
      options.config,
      new Set(plugged.keys()),
    );
    const meta = plugged.get(spec.id);
    const manifestPlugin = options.manifest?.plugins?.[spec.id];
    rows.push(
      await buildRow({
        id: spec.id,
        origin: "core",
        state: on ? "on" : "off",
        version: meta?.version ?? manifestPlugin?.version ?? null,
        summary: spec.summary,
        declares: meta?.declares ?? manifestPlugin?.declares ?? [],
        interceptStages: meta?.intercepts ?? manifestPlugin?.intercepts ?? [],
        scopes: meta?.scopes ?? [],
        costs,
        capabilityDiff: capabilityAll[spec.id] ?? [],
        options,
        enableHint: enableHintForCore(spec.id, on),
      }),
    );
  }

  for (const [id, meta] of plugged) {
    if (CORE_PLUGINS.some((c) => c.id === id)) continue;
    const origin = resolveOrigin(id, options.manifest?.plugins?.[id]);
    if (origin === "core") continue; // already listed
    rows.push(
      await buildRow({
        id,
        origin,
        state: "on",
        version: meta.version,
        summary: null,
        declares: meta.declares,
        interceptStages: meta.intercepts,
        scopes: meta.scopes,
        costs,
        capabilityDiff: capabilityAll[id] ?? [],
        options,
        enableHint: null,
      }),
    );
  }

  rows.sort((a, b) => {
    const originOrder = { core: 0, local: 1, community: 2 } as const;
    if (originOrder[a.origin] !== originOrder[b.origin]) {
      return originOrder[a.origin] - originOrder[b.origin];
    }
    if (a.state !== b.state) return a.state === "on" ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  return {
    plugins: rows,
    stateDerivation: PLUGIN_STATE_DERIVATION,
  };
}

interface PluggedMeta {
  readonly version: string | null;
  readonly declares: readonly string[];
  readonly intercepts: readonly string[];
  readonly scopes: readonly PluginScopeView[];
  readonly origin?: PluginOrigin;
}

function collectPlugged(
  manifest: Manifest | null,
  registry: PluginRegistry | null | undefined,
): Map<string, PluggedMeta> {
  const out = new Map<string, PluggedMeta>();
  if (manifest?.plugins) {
    for (const [id, p] of Object.entries(manifest.plugins)) {
      out.set(id, {
        version: p.version ?? null,
        declares: p.declares ?? [],
        intercepts: p.intercepts ?? [],
        scopes: [],
        origin: p.origin,
      });
    }
  }
  if (registry) {
    for (const entry of registry.installed) {
      const id = entry.plugin.name;
      const caps = entry.registration.capabilities;
      const prev = out.get(id);
      const scope: PluginScopeView =
        entry.scope.kind === "app"
          ? { kind: "app" }
          : { kind: entry.scope.kind, name: entry.scope.name };
      const scopes = [...(prev?.scopes ?? []), scope];
      out.set(id, {
        version: caps.version ?? prev?.version ?? null,
        declares: caps.declares.length
          ? [...caps.declares]
          : (prev?.declares ?? []),
        intercepts: caps.intercepts.length
          ? [...caps.intercepts]
          : (prev?.intercepts ?? []),
        scopes,
        origin: prev?.origin,
      });
    }
  }
  return out;
}

function resolveOrigin(id: string, plugin: Plugin | undefined): PluginOrigin {
  if (plugin?.origin) return plugin.origin;
  if (CORE_PLUGINS.some((c) => c.id === id)) return "core";
  // Heuristic: path-like / relative → local; else community.
  if (id.startsWith(".") || id.startsWith("/") || id.includes("/src/")) {
    return "local";
  }
  return plugin ? "local" : "community";
}

async function buildRow(input: {
  readonly id: string;
  readonly origin: PluginOrigin;
  readonly state: PluginState;
  readonly version: string | null;
  readonly summary: string | null;
  readonly declares: readonly string[];
  readonly interceptStages: readonly string[];
  readonly scopes: readonly PluginScopeView[];
  readonly costs: Readonly<Record<string, HookCostSummary>>;
  readonly capabilityDiff: readonly ManifestChange[];
  readonly options: ProjectPluginsOptions;
  readonly enableHint: string | null;
}): Promise<ConsolePluginRow> {
  const packageName =
    input.origin === "community" ? communityPackageName(input.id) : null;
  const cost = input.costs[input.id] ?? null;
  const intercepts = input.interceptStages.map((stage) => {
    const stageCost = cost?.byStage[
      stage as keyof NonNullable<typeof cost>["byStage"]
    ];
    return {
      stage,
      meanMs: stageCost?.meanMs ?? null,
      count: stageCost?.count ?? 0,
    };
  });

  const supplyOpts = {
    origin: input.origin,
    packageName,
    cwd: input.options.cwd,
    now: input.options.now(),
    packageJson: input.options.packageJsonByPlugin?.[input.id],
    sources: input.options.sourcesByPlugin?.[input.id] ?? null,
    bootConflicts: input.options.bootConflictsByPlugin?.[input.id] ?? [],
    fetchNpm: input.options.fetchNpm,
  };

  const { projectSupplyChain, projectSupplyChainSync } = await import(
    "../../plugins/supply-chain.ts"
  );
  const supplyChain = input.options.syncSupplyChain
    ? projectSupplyChainSync(supplyOpts)
    : await projectSupplyChain(supplyOpts);

  return {
    id: input.id,
    origin: input.origin,
    state: input.state,
    version: input.version,
    summary: input.summary,
    scopes: input.scopes,
    declares: [...input.declares],
    intercepts,
    hookCost: cost
      ? {
          count: cost.count,
          meanMs: cost.meanMs,
          p50Ms: cost.p50Ms,
          p95Ms: cost.p95Ms,
          lastMs: cost.lastMs,
        }
      : null,
    supplyChain,
    capabilityDiff: input.capabilityDiff.map((c) => ({
      path: c.path,
      category: c.category,
      kind: c.kind,
      summary: c.summary,
    })),
    installCommand:
      input.origin === "community" && packageName
        ? `bun add ${packageName}`
        : null,
    enableHint: input.enableHint,
    packageName,
  };
}

/**
 * Filter doctor `--diff` / merge-base changes to one plugin path.
 *
 * @param cwd - Repo root
 * @param manifest - Working-tree after Manifest (optional injection via doctor)
 */
export async function loadCapabilityDiffByPlugin(
  cwd: string,
  manifest: Manifest | null,
): Promise<Readonly<Record<string, readonly ManifestChange[]>>> {
  try {
    const { runDoctorDiff } = await import("../../cli/doctor-diff.ts");
    const result = await runDoctorDiff({
      cwd,
      ...(manifest ? { after: manifest } : {}),
      write: () => {},
    });
    return groupPluginChanges(result.allChanges);
  } catch {
    return {};
  }
}

/**
 * Group Manifest changes under `/plugins/{id}`.
 *
 * @param changes - Full `diffManifest` result
 */
export function groupPluginChanges(
  changes: readonly ManifestChange[],
): Readonly<Record<string, readonly ManifestChange[]>> {
  const out: Record<string, ManifestChange[]> = {};
  for (const c of changes) {
    const m = /^\/plugins\/([^/]+)/.exec(c.path);
    if (!m) continue;
    const id = m[1]!;
    const list = out[id] ?? [];
    list.push(c);
    out[id] = list;
  }
  return out;
}

/**
 * Filter precomputed changes to one plugin (UI helper; no recompute).
 *
 * @param changes - Diff changes
 * @param pluginId - Plugin id
 */
export function filterCapabilityDiffForPlugin(
  changes: readonly ManifestChange[],
  pluginId: string,
): readonly ManifestChange[] {
  const prefix = `/plugins/${pluginId}`;
  return changes.filter(
    (c) => c.path === prefix || c.path.startsWith(`${prefix}/`),
  );
}

function communityPackageName(id: string): string {
  if (id.startsWith("@")) return id;
  if (id.startsWith("oke-") || id.startsWith("okengine-")) return id;
  return id;
}

function enableHintForCore(id: string, on: boolean): string | null {
  if (on) return null;
  switch (id) {
    case "auth":
      return "app.plug(auth())";
    case "console":
      return "app.plug(consolePlugin())";
    case "rate-limit":
      return "app.plug(rateLimit({ max: 30 }))  // or unit.plug / flow.plug";
    case "tenancy":
      return "oke.config.ts → tenancy: { isolation: \"row\", resolve: … }";
    case "privacy":
      return "oke.config.ts → privacy: { … }  // or runs: { redact: { … } }";
    default:
      return null;
  }
}
