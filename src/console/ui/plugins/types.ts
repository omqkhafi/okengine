/**
 * Plugins panel view types (console §9.15).
 */

/** Supply-chain origin. */
export type PluginOrigin = "core" | "local" | "community";

/** Derived on/off. */
export type PluginState = "on" | "off";

/** Attachment scope. */
export interface PluginScopeRecord {
  readonly kind: "app" | "unit" | "flow";
  readonly name?: string;
}

/** Intercept with measured cost. */
export interface PluginInterceptRecord {
  readonly stage: string;
  readonly meanMs: number | null;
  readonly count: number;
}

/** Capability diff line from `diffManifest` (merge-base). */
export interface PluginCapabilityChangeRecord {
  readonly path: string;
  readonly category: string;
  readonly kind: string;
  readonly summary: string;
}

/** Lifecycle scripts signal. */
export interface LifecycleScriptsSignal {
  readonly state: "pass" | "fail" | "not-applicable" | "unknown";
  readonly scripts: readonly string[];
  readonly detail: string;
}

/** Release cooldown signal. */
export interface ReleaseCooldownSignal {
  readonly state: "pass" | "hold" | "not-applicable" | "unknown";
  readonly publishedAt: number | null;
  readonly holdUntil: number | null;
  readonly detail: string;
}

/** Node-import scan signal. */
export interface NodeImportScanSignal {
  readonly state: "pass" | "fail" | "not-applicable" | "unknown";
  readonly findings: readonly {
    readonly source: string;
    readonly specifier: string;
    readonly line: number | null;
  }[];
  readonly detail: string;
}

/** npm provenance signal. */
export interface NpmProvenanceSignal {
  readonly state: "pass" | "fail" | "not-applicable" | "unknown";
  readonly detail: string;
}

/** Boot conflict signal. */
export interface BootConflictSignal {
  readonly state: "clean" | "conflict" | "not-applicable";
  readonly conflicts: readonly string[];
  readonly detail: string;
}

/** Supply-chain strip. */
export interface SupplyChainRecord {
  readonly lifecycleScripts: LifecycleScriptsSignal;
  readonly releaseCooldown: ReleaseCooldownSignal;
  readonly nodeImportScan: NodeImportScanSignal;
  readonly npmProvenance: NpmProvenanceSignal;
  readonly bootConflicts: BootConflictSignal;
}

/** One plugin row. */
export interface PluginRecord {
  readonly id: string;
  readonly origin: PluginOrigin;
  readonly state: PluginState;
  readonly version: string | null;
  readonly summary: string | null;
  readonly scopes: readonly PluginScopeRecord[];
  readonly declares: readonly string[];
  readonly tables: Readonly<
    Record<string, { readonly plane?: string; readonly description?: string }>
  >;
  readonly intercepts: readonly PluginInterceptRecord[];
  readonly hookCost: {
    readonly count: number;
    readonly meanMs: number;
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly lastMs: number | null;
  } | null;
  readonly supplyChain: SupplyChainRecord;
  readonly capabilityDiff: readonly PluginCapabilityChangeRecord[];
  readonly installCommand: string | null;
  readonly enableHint: string | null;
  readonly packageName: string | null;
}

/** `console.plugin.list` response. */
export interface PluginsListResponse {
  readonly plugins: readonly PluginRecord[];
  readonly stateDerivation: string;
}

/** Grouped list section. */
export interface PluginsListGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly PluginRecord[];
}
