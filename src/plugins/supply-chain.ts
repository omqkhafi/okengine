/**
 * Real plugin supply-chain signals (console §9.15).
 *
 * Explicit "not applicable" / "unknown" — never fabricated passes.
 */

import { resolve } from "node:path";
import type { PluginOrigin } from "../manifest/types.ts";
import {
  scanNodeImportsBypassingFx,
  type NodeImportFinding,
  type ScanSourceFile,
} from "./node-import-scan.ts";

/** Release cooldown window — "a few days" per §9.15. */
export const RELEASE_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

/** Lifecycle script keys that fail `oke doctor` for plugins. */
export const FORBIDDEN_LIFECYCLE_SCRIPTS = [
  "preinstall",
  "install",
  "postinstall",
  "preuninstall",
  "uninstall",
  "postuninstall",
  "preprepare",
  "prepare",
  "postprepare",
] as const;

/** Signal applicability / result states. */
export type SupplySignalState =
  | "pass"
  | "fail"
  | "hold"
  | "not-applicable"
  | "unknown"
  | "clean"
  | "conflict";

/** Lifecycle-scripts check. */
export interface LifecycleScriptsSignal {
  readonly state: "pass" | "fail" | "not-applicable" | "unknown";
  readonly scripts: readonly string[];
  readonly detail: string;
}

/** Release-cooldown status (community only). */
export interface ReleaseCooldownSignal {
  readonly state: "pass" | "hold" | "not-applicable" | "unknown";
  readonly publishedAt: number | null;
  readonly holdUntil: number | null;
  readonly detail: string;
}

/** Oxc `node:` / `bun:` bypass scan. */
export interface NodeImportScanSignal {
  readonly state: "pass" | "fail" | "not-applicable" | "unknown";
  readonly findings: readonly NodeImportFinding[];
  readonly detail: string;
}

/** npm provenance (best-effort). */
export interface NpmProvenanceSignal {
  readonly state: "pass" | "fail" | "not-applicable" | "unknown";
  readonly detail: string;
}

/** Boot-time naming conflict already detected. */
export interface BootConflictSignal {
  readonly state: "clean" | "conflict" | "not-applicable";
  readonly conflicts: readonly string[];
  readonly detail: string;
}

/** Full supply-chain strip for one plugin. */
export interface SupplyChainSignals {
  readonly lifecycleScripts: LifecycleScriptsSignal;
  readonly releaseCooldown: ReleaseCooldownSignal;
  readonly nodeImportScan: NodeImportScanSignal;
  readonly npmProvenance: NpmProvenanceSignal;
  readonly bootConflicts: BootConflictSignal;
}

/** Inputs for {@link projectSupplyChain}. */
export interface ProjectSupplyChainOptions {
  readonly origin: PluginOrigin;
  readonly packageName: string | null;
  readonly cwd: string;
  readonly now: number;
  /** Injected package.json (tests). */
  readonly packageJson?: PackageJsonProbe | null;
  /** Plugin sources for oxc scan; null → unknown / N/A. */
  readonly sources?: readonly ScanSourceFile[] | null;
  /** Injected publish time (epoch ms); null → fetch / unknown. */
  readonly publishedAt?: number | null;
  /** Injected provenance result (tests). */
  readonly provenance?: "attested" | "missing" | "unknown" | null;
  /** Boot conflicts naming this plugin. */
  readonly bootConflicts?: readonly string[];
  /** Skip network (tests / offline). */
  readonly fetchNpm?: boolean;
}

/** Minimal package.json probe. */
export interface PackageJsonProbe {
  readonly name?: string;
  readonly version?: string;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly time?: Readonly<Record<string, string>>;
}

/**
 * Project supply-chain signals with honest N/A / unknown states.
 *
 * @param options - Origin, package, sources, clock
 */
export async function projectSupplyChain(
  options: ProjectSupplyChainOptions,
): Promise<SupplyChainSignals> {
  const origin = options.origin;
  const boot = projectBootConflicts(origin, options.bootConflicts ?? []);

  if (origin === "core" || origin === "local") {
    return {
      lifecycleScripts: {
        state: "not-applicable",
        scripts: [],
        detail: `Lifecycle scripts apply to community packages only (${origin})`,
      },
      releaseCooldown: {
        state: "not-applicable",
        publishedAt: null,
        holdUntil: null,
        detail: `Release cooldown applies to community registry packages only (${origin})`,
      },
      nodeImportScan: projectNodeScan(options.sources),
      npmProvenance: {
        state: "not-applicable",
        detail: `npm provenance applies to community registry packages only (${origin})`,
      },
      bootConflicts: boot,
    };
  }

  // community
  const pkgJson =
    options.packageJson !== undefined
      ? options.packageJson
      : options.packageName
        ? await readPackageJson(options.cwd, options.packageName)
        : null;

  const lifecycle = projectLifecycle(pkgJson);
  const cooldown = await projectCooldown(options, pkgJson);
  const nodeScan = projectNodeScan(options.sources);
  const provenance = await projectProvenance(options);

  return {
    lifecycleScripts: lifecycle,
    releaseCooldown: cooldown,
    nodeImportScan: nodeScan,
    npmProvenance: provenance,
    bootConflicts: boot,
  };
}

/**
 * Synchronous projection for tests (no network).
 *
 * @param options - Same as async, with injections
 */
export function projectSupplyChainSync(
  options: ProjectSupplyChainOptions & {
    readonly packageJson?: PackageJsonProbe | null;
    readonly publishedAt?: number | null;
    readonly provenance?: "attested" | "missing" | "unknown" | null;
  },
): SupplyChainSignals {
  const origin = options.origin;
  const boot = projectBootConflicts(origin, options.bootConflicts ?? []);
  if (origin === "core" || origin === "local") {
    return {
      lifecycleScripts: {
        state: "not-applicable",
        scripts: [],
        detail: `Lifecycle scripts apply to community packages only (${origin})`,
      },
      releaseCooldown: {
        state: "not-applicable",
        publishedAt: null,
        holdUntil: null,
        detail: `Release cooldown applies to community registry packages only (${origin})`,
      },
      nodeImportScan: projectNodeScan(options.sources),
      npmProvenance: {
        state: "not-applicable",
        detail: `npm provenance applies to community registry packages only (${origin})`,
      },
      bootConflicts: boot,
    };
  }

  const lifecycle = projectLifecycle(options.packageJson ?? null);
  const publishedAt = options.publishedAt ?? null;
  let cooldown: ReleaseCooldownSignal;
  if (publishedAt === null) {
    cooldown = {
      state: "unknown",
      publishedAt: null,
      holdUntil: null,
      detail: "Publish time unknown (offline or metadata missing)",
    };
  } else {
    const holdUntil = publishedAt + RELEASE_COOLDOWN_MS;
    const held = options.now < holdUntil;
    cooldown = {
      state: held ? "hold" : "pass",
      publishedAt,
      holdUntil,
      detail: held
        ? `Published within cooldown — held until ${new Date(holdUntil).toISOString()}`
        : "Outside release cooldown window",
    };
  }

  let provenance: NpmProvenanceSignal;
  if (options.provenance === "attested") {
    provenance = { state: "pass", detail: "npm provenance attestation present" };
  } else if (options.provenance === "missing") {
    provenance = {
      state: "fail",
      detail: "Published without npm provenance attestation",
    };
  } else {
    provenance = {
      state: "unknown",
      detail: "Provenance unknown (offline or non-npm)",
    };
  }

  return {
    lifecycleScripts: lifecycle,
    releaseCooldown: cooldown,
    nodeImportScan: projectNodeScan(options.sources),
    npmProvenance: provenance,
    bootConflicts: boot,
  };
}

function projectLifecycle(
  pkg: PackageJsonProbe | null,
): LifecycleScriptsSignal {
  if (!pkg) {
    return {
      state: "unknown",
      scripts: [],
      detail: "package.json not found — cannot verify lifecycle scripts",
    };
  }
  const scripts = Object.keys(pkg.scripts ?? {}).filter((k) =>
    (FORBIDDEN_LIFECYCLE_SCRIPTS as readonly string[]).includes(k),
  );
  if (scripts.length > 0) {
    return {
      state: "fail",
      scripts,
      detail: `Forbidden lifecycle scripts: ${scripts.join(", ")}`,
    };
  }
  return {
    state: "pass",
    scripts: [],
    detail: "No install/prepare lifecycle scripts",
  };
}

async function projectCooldown(
  options: ProjectSupplyChainOptions,
  pkg: PackageJsonProbe | null,
): Promise<ReleaseCooldownSignal> {
  let publishedAt = options.publishedAt ?? null;
  if (publishedAt === null && options.fetchNpm !== false && options.packageName) {
    publishedAt = await fetchPublishedAt(options.packageName, pkg?.version);
  }
  if (publishedAt === null) {
    return {
      state: "unknown",
      publishedAt: null,
      holdUntil: null,
      detail: "Publish time unknown (offline or metadata missing)",
    };
  }
  const holdUntil = publishedAt + RELEASE_COOLDOWN_MS;
  const held = options.now < holdUntil;
  return {
    state: held ? "hold" : "pass",
    publishedAt,
    holdUntil,
    detail: held
      ? `Published within cooldown — held until ${new Date(holdUntil).toISOString()}`
      : "Outside release cooldown window",
  };
}

function projectNodeScan(
  sources: readonly ScanSourceFile[] | null | undefined,
): NodeImportScanSignal {
  if (sources === null || sources === undefined) {
    return {
      state: "unknown",
      findings: [],
      detail: "No plugin sources available to scan",
    };
  }
  if (sources.length === 0) {
    return {
      state: "not-applicable",
      findings: [],
      detail: "No source files to scan",
    };
  }
  const findings = scanNodeImportsBypassingFx(sources);
  if (findings.length > 0) {
    return {
      state: "fail",
      findings,
      detail: `${findings.length} direct node:/bun: import(s) bypassing fx`,
    };
  }
  return {
    state: "pass",
    findings: [],
    detail: "No direct node:/bun: imports detected",
  };
}

async function projectProvenance(
  options: ProjectSupplyChainOptions,
): Promise<NpmProvenanceSignal> {
  if (options.provenance === "attested") {
    return { state: "pass", detail: "npm provenance attestation present" };
  }
  if (options.provenance === "missing") {
    return {
      state: "fail",
      detail: "Published without npm provenance attestation",
    };
  }
  if (options.provenance === "unknown") {
    return {
      state: "unknown",
      detail: "Provenance unknown (offline or non-npm)",
    };
  }
  if (options.fetchNpm === false || !options.packageName) {
    return {
      state: "unknown",
      detail: "Provenance unknown (offline or non-npm)",
    };
  }
  const result = await fetchNpmProvenance(options.packageName);
  return result;
}

function projectBootConflicts(
  origin: PluginOrigin,
  conflicts: readonly string[],
): BootConflictSignal {
  if (conflicts.length > 0) {
    return {
      state: "conflict",
      conflicts: [...conflicts],
      detail: conflicts.join("; "),
    };
  }
  // Conflicts fail boot — a running Console implies clean for installed plugins.
  return {
    state: "clean",
    conflicts: [],
    detail:
      origin === "core" && conflicts.length === 0
        ? "No boot-time naming conflicts detected"
        : "No boot-time naming conflicts detected",
  };
}

async function readPackageJson(
  cwd: string,
  packageName: string,
): Promise<PackageJsonProbe | null> {
  const path = resolve(cwd, "node_modules", ...packageName.split("/"), "package.json");
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    return (await file.json()) as PackageJsonProbe;
  } catch {
    return null;
  }
}

async function fetchPublishedAt(
  packageName: string,
  version: string | undefined,
): Promise<number | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${packageName}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      time?: Record<string, string>;
      "dist-tags"?: { latest?: string };
    };
    const ver = version ?? body["dist-tags"]?.latest;
    const iso = ver ? body.time?.[ver] : undefined;
    if (!iso) return null;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

async function fetchNpmProvenance(
  packageName: string,
): Promise<NpmProvenanceSignal> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${packageName}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return {
        state: "unknown",
        detail: "Provenance unknown (offline or non-npm)",
      };
    }
    const body = (await res.json()) as {
      "dist-tags"?: { latest?: string };
      versions?: Record<
        string,
        { dist?: { attestations?: unknown; signatures?: unknown } }
      >;
    };
    const latest = body["dist-tags"]?.latest;
    const dist = latest ? body.versions?.[latest]?.dist : undefined;
    if (dist?.attestations != null || dist?.signatures != null) {
      return { state: "pass", detail: "npm provenance attestation present" };
    }
    return {
      state: "fail",
      detail: "Published without npm provenance attestation",
    };
  } catch {
    return {
      state: "unknown",
      detail: "Provenance unknown (offline or non-npm)",
    };
  }
}
