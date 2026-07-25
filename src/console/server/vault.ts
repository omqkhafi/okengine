/**
 * Console Vault projection — Manifest + VaultRuntime over `fx` (console §9.8).
 *
 * Secrets are write-only: fingerprints only, never cleartext. Config
 * (non-sensitive) may appear in the clear. Resolution chain, readers, and
 * rotation blast radius are derived — never reimplemented in the UI.
 */

import { resolve } from "node:path";
import type { ConfigEnv } from "../../config/index.ts";
import { envVaultDriver, memoryVaultDriver } from "../../drivers/index.ts";
import {
  createVaultRuntime,
  vault as declareVault,
  type VaultResolutionSource,
  type VaultResolutionStep,
  type VaultRuntime,
  type VaultSecretDecl,
} from "../../elements/vault.ts";
import type { JournalRun, JournalStore } from "../../kernel/journal.ts";
import type { Manifest } from "../../manifest/types.ts";

/** Environment label for fingerprint columns. */
export type VaultEnvLabel = ConfigEnv | "staging" | (string & {});

/** Fingerprints keyed by environment — never values. */
export type VaultFingerprintsByEnv = Readonly<
  Partial<Record<VaultEnvLabel, string>>
>;

/** Rotation blast radius from the durable journal (queried, not estimated). */
export interface ConsoleVaultBlastRadius {
  /** Count of in-flight sleeping durable runs that declare this secret. */
  readonly count: number;
  /** Absolute epoch-ms of the furthest outstanding wake (`null` when count=0). */
  readonly longestWakeAt: number | null;
  /** Milliseconds until {@link longestWakeAt} from `now` (clamped ≥ 0). */
  readonly longestOutstandingMs: number | null;
  /** Run ids contributing to the blast radius (for Clock deep-links). */
  readonly runIds: readonly string[];
}

/** One row in `console.vault.list`. */
export interface ConsoleVaultRow {
  readonly name: string;
  /** `"secret"` is fingerprinted; `"config"` may show cleartext. */
  readonly kind: "secret" | "config";
  readonly sensitive: boolean;
  readonly description?: string;
  readonly rotate?: string;
  /**
   * Per-environment fingerprints. Secrets only — config leaves this empty
   * and uses {@link cleartext} instead.
   */
  readonly fingerprints: VaultFingerprintsByEnv;
  /** Current environment's fingerprint (convenience). */
  readonly fingerprint: string | null;
  /** Cleartext for non-sensitive config only; always `null` for secrets. */
  readonly cleartext: string | null;
  /** Which layer won in the current environment. */
  readonly winner: VaultResolutionSource | null;
  /** Full resolution chain for the current environment. */
  readonly resolution: readonly VaultResolutionStep[];
  /** Flow ids that declare `fx.vault(name)` in Manifest effects. */
  readonly readers: readonly string[];
  /** In-flight durable runs that will wake holding a new key after rotate. */
  readonly blastRadius: ConsoleVaultBlastRadius;
  /** Epoch-ms of last `fx.vault` / runtime read; `null` if never read. */
  readonly lastReadAt: number | null;
  /**
   * When the current fingerprint equals another environment's — warning,
   * not error (may be deliberate).
   */
  readonly sharedFingerprintEnvs: readonly VaultEnvLabel[];
}

/** Options when projecting the vault list. */
export interface ProjectVaultOptions {
  readonly manifest: Manifest | null;
  readonly runtime: VaultRuntime | null;
  /** Current process environment label. */
  readonly env?: VaultEnvLabel;
  /**
   * Optional peer-environment fingerprints (e.g. staging from a remote
   * probe). Never values — fingerprints only.
   */
  readonly peerFingerprints?: Readonly<
    Record<string, VaultFingerprintsByEnv>
  >;
  /** Durable journal — blast radius is queried, not estimated. */
  readonly journal?: JournalStore | null;
  readonly now?: () => number;
}

/**
 * Project Manifest vault contracts into operator rows.
 *
 * @param options - Manifest, runtime, journal
 */
export async function projectVaultList(
  options: ProjectVaultOptions,
): Promise<{
  readonly secrets: readonly ConsoleVaultRow[];
  readonly env: VaultEnvLabel;
}> {
  const env = options.env ?? "dev";
  const now = options.now ?? (() => Date.now());
  const names = collectNames(options.manifest, options.runtime);
  const journalRuns = options.journal
    ? await options.journal.list()
    : ([] as readonly JournalRun[]);

  const secrets: ConsoleVaultRow[] = [];
  for (const name of names) {
    const contract = contractOf(name, options.manifest, options.runtime);
    const sensitive = contract.sensitive;
    const readers = readersOf(options.manifest, name);
    const blastRadius = blastRadiusOf(
      journalRuns,
      readers,
      now(),
    );
    const winner = options.runtime?.resolution(name) ?? null;
    const resolution = options.runtime?.resolutionChain(name) ?? [];
    const lastReadAt = options.runtime?.lastReadAt(name) ?? null;

    let fingerprint: string | null = null;
    let cleartext: string | null = null;
    const fingerprints: Record<string, string> = {};

    if (sensitive) {
      fingerprint = options.runtime?.fingerprint(name) ?? null;
      if (fingerprint) fingerprints[env] = fingerprint;
      const peers = options.peerFingerprints?.[name];
      if (peers) {
        for (const [e, fp] of Object.entries(peers)) {
          if (typeof fp === "string" && fp.length > 0) fingerprints[e] = fp;
        }
      }
    } else {
      cleartext = options.runtime?.cleartext(name) ?? null;
    }

    const sharedFingerprintEnvs = sensitive
      ? sharedEnvs(fingerprints, env, fingerprint)
      : [];

    secrets.push({
      name,
      kind: contract.kind,
      sensitive,
      ...(contract.description !== undefined
        ? { description: contract.description }
        : {}),
      ...(contract.rotate !== undefined ? { rotate: contract.rotate } : {}),
      fingerprints,
      fingerprint,
      cleartext,
      winner,
      resolution,
      readers,
      blastRadius,
      lastReadAt,
      sharedFingerprintEnvs,
    });
  }

  return { secrets, env };
}

/** Input for set / rotate. */
export interface VaultWriteInput {
  readonly name: string;
  readonly value: string;
}

/**
 * Set a vault value via the runtime (write-only — never returns the value).
 *
 * @param runtime - Vault runtime
 * @param input - Name + new value
 */
export function setVaultValue(
  runtime: VaultRuntime,
  input: VaultWriteInput,
): { readonly name: string; readonly fingerprint: string | null } {
  runtime.put(input.name, input.value);
  return {
    name: input.name,
    fingerprint: runtime.isSensitive(input.name)
      ? (runtime.fingerprint(input.name) ?? null)
      : null,
  };
}

/**
 * Rotate = set a new value (same write path; distinct Console action + confirm).
 *
 * @param runtime - Vault runtime
 * @param input - Name + new value
 */
export function rotateVaultValue(
  runtime: VaultRuntime,
  input: VaultWriteInput,
): { readonly name: string; readonly fingerprint: string | null } {
  return setVaultValue(runtime, input);
}

/**
 * Build a VaultRuntime from Manifest contracts when no host runtime is attached.
 *
 * Uses the standard resolution chain: process.env → .env.local → .env.stack
 * → memory driver → (optional) dev fallback. Does not parse dotenv in the UI.
 *
 * @param manifest - Manifest snapshot
 * @param options - cwd / env / allowDevFallbacks / seed
 */
export async function createManifestVaultRuntime(
  manifest: Manifest,
  options: {
    readonly cwd?: string;
    readonly env?: ConfigEnv;
    readonly allowDevFallbacks?: boolean;
    readonly seed?: Readonly<Record<string, string>>;
    readonly now?: () => number;
  } = {},
): Promise<VaultRuntime | null> {
  const entries = Object.entries(manifest.vault ?? {});
  if (entries.length === 0) return null;

  const cwd = options.cwd ?? process.cwd();
  const secrets: VaultSecretDecl[] = entries.map(([name, c]) => {
    const sensitive = c.sensitive !== false;
    if (sensitive) {
      return declareVault.secret(name, {
        description: c.description,
        rotate: c.rotate,
        schema: c.schema,
        sensitive: true,
      });
    }
    return declareVault.config(name, {
      description: c.description,
      rotate: c.rotate,
      schema: c.schema,
      sensitive: false,
    });
  });

  const seed = options.seed ?? {};
  const runtime = createVaultRuntime({
    secrets,
    allowDevFallbacks:
      options.allowDevFallbacks ?? (options.env ?? "dev") !== "prod",
    now: options.now,
    chain: [
      { driver: envVaultDriver, source: "process.env" },
      {
        driver: envVaultDriver,
        source: ".env.local",
        options: { path: resolve(cwd, ".env.local") },
      },
      {
        driver: envVaultDriver,
        source: ".env.stack",
        options: { path: resolve(cwd, ".env.stack") },
      },
      {
        driver: memoryVaultDriver,
        source: "driver",
        options: { secrets: seed },
      },
    ],
  });
  await runtime.boot();
  return runtime;
}

/**
 * Query journal for sleeping durable runs whose flows read `secretName`.
 *
 * @param runs - Journal runs
 * @param readerFlowIds - Flows that declare the secret
 * @param now - Clock
 */
export function blastRadiusOf(
  runs: readonly JournalRun[],
  readerFlowIds: readonly string[],
  now: number,
): ConsoleVaultBlastRadius {
  const readers = new Set(readerFlowIds);
  const affected = runs.filter(
    (r) =>
      r.status === "sleeping" &&
      r.wakeAt != null &&
      readers.has(r.flow),
  );
  if (affected.length === 0) {
    return {
      count: 0,
      longestWakeAt: null,
      longestOutstandingMs: null,
      runIds: [],
    };
  }
  let longestWakeAt = 0;
  const runIds: string[] = [];
  for (const r of affected) {
    runIds.push(r.id);
    if ((r.wakeAt ?? 0) > longestWakeAt) longestWakeAt = r.wakeAt ?? 0;
  }
  return {
    count: affected.length,
    longestWakeAt,
    longestOutstandingMs: Math.max(0, longestWakeAt - now),
    runIds,
  };
}

/**
 * Flow ids that declare `effects.secrets` including `name`.
 *
 * @param manifest - Manifest
 * @param name - Secret name
 */
export function readersOf(
  manifest: Manifest | null,
  name: string,
): readonly string[] {
  if (!manifest?.flows) return [];
  const out: string[] = [];
  for (const [flowId, flow] of Object.entries(manifest.flows)) {
    if (flow.effects?.secrets?.includes(name)) out.push(flowId);
  }
  return out.sort();
}

/**
 * @param manifest - Manifest
 * @param runtime - Runtime
 */
function collectNames(
  manifest: Manifest | null,
  runtime: VaultRuntime | null,
): readonly string[] {
  const set = new Set<string>();
  for (const name of Object.keys(manifest?.vault ?? {})) set.add(name);
  if (runtime) {
    for (const name of runtime.contracts.keys()) set.add(name);
    for (const name of runtime.names()) set.add(name);
  }
  return [...set].sort();
}

/**
 * @param name - Contract name
 * @param manifest - Manifest
 * @param runtime - Runtime
 */
function contractOf(
  name: string,
  manifest: Manifest | null,
  runtime: VaultRuntime | null,
): {
  readonly kind: "secret" | "config";
  readonly sensitive: boolean;
  readonly description?: string;
  readonly rotate?: string;
} {
  const fromRuntime = runtime?.contracts.get(name);
  if (fromRuntime) {
    return {
      kind: fromRuntime.kind,
      sensitive: fromRuntime.sensitive,
      ...(fromRuntime.description !== undefined
        ? { description: fromRuntime.description }
        : {}),
      ...(fromRuntime.rotate !== undefined
        ? { rotate: fromRuntime.rotate }
        : {}),
    };
  }
  const fromManifest = manifest?.vault?.[name];
  const sensitive = fromManifest?.sensitive !== false;
  return {
    kind: sensitive ? "secret" : "config",
    sensitive,
    ...(fromManifest?.description !== undefined
      ? { description: fromManifest.description }
      : {}),
    ...(fromManifest?.rotate !== undefined
      ? { rotate: fromManifest.rotate }
      : {}),
  };
}

/**
 * Environments (other than current) that share the same fingerprint.
 *
 * @param fingerprints - By env
 * @param env - Current env
 * @param fingerprint - Current fingerprint
 */
function sharedEnvs(
  fingerprints: Readonly<Record<string, string>>,
  env: VaultEnvLabel,
  fingerprint: string | null,
): readonly VaultEnvLabel[] {
  if (!fingerprint) return [];
  return Object.entries(fingerprints)
    .filter(([e, fp]) => e !== env && fp === fingerprint)
    .map(([e]) => e as VaultEnvLabel)
    .sort();
}

/** Assert a Console row never embeds a secret value (tests / export safety). */
export function assertNoSecretLeak(
  row: ConsoleVaultRow,
  knownSecrets: readonly string[],
): void {
  const blob = JSON.stringify(row);
  for (const secret of knownSecrets) {
    if (secret.length === 0) continue;
    if (blob.includes(secret)) {
      throw new Error(
        `vault console leak: secret value appears in row for ${row.name}`,
      );
    }
  }
}
