/**
 * Console Vault projection — Manifest + VaultRuntime over `fx` (console §9.8).
 *
 * Secrets are write-only: fingerprints only, never cleartext. Config
 * (non-sensitive) may appear in the clear. Resolution chain, readers, and
 * rotation blast radius are derived — never reimplemented in the UI.
 */

import { resolveDriverId, type ConfigEnv, type OkeConfig } from "../../config/index.ts";
import { VAULT_DEFAULTS } from "../../config/driver-defaults.ts";
import { memoryVaultDriver } from "../../drivers/index.ts";
import type { VaultDriverId } from "../../drivers/vault-types.ts";
import { buildVaultBootChain, normalizeVaultDriverId } from "../../elements/vault/boot-chain.ts";
import {
  createVaultRuntime,
  VaultError,
  vault as declareVault,
  type VaultChainLayer,
  type VaultResolutionSource,
  type VaultResolutionStep,
  type VaultRuntime,
  type VaultSecretDecl,
} from "../../elements/vault.ts";
import type { VaultStatus } from "../../elements/vault/types.ts";
import type { AuditChainBreakReason, VaultAuditRecord } from "../../elements/vault/storage.ts";
import type { JournalRun, JournalStore } from "../../kernel/journal.ts";
import type { Manifest } from "../../manifest/types.ts";
import {
  isVaultContractName,
  loadVaultOverlay,
  upsertVaultOverlay,
  type VaultOverlayContract,
} from "./vault-overlay.ts";

/** Environment label for fingerprint columns. */
export type VaultEnvLabel = ConfigEnv | "staging" | (string & {});

/** Fingerprints keyed by environment — never values. */
export type VaultFingerprintsByEnv = Readonly<Partial<Record<VaultEnvLabel, string>>>;

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
  /** Flow ids that declare `fx.vault.get(name)` in Manifest effects. */
  readonly readers: readonly string[];
  /** In-flight durable runs that will wake holding a new key after rotate. */
  readonly blastRadius: ConsoleVaultBlastRadius;
  /** Epoch-ms of last `fx.vault.get` / runtime read; `null` if never read. */
  readonly lastReadAt: number | null;
  /**
   * When the current fingerprint equals another environment's — warning,
   * not error (may be deliberate).
   */
  readonly sharedFingerprintEnvs: readonly VaultEnvLabel[];
  /**
   * `"source"` is Manifest / `vault.secret`. `"console"` is an operator
   * Add that is not in the Manifest yet.
   */
  readonly origin?: "source" | "console";
}

/**
 * Built-in Vault backend state, JSON-safe (dates become epoch-ms).
 *
 * Mirrors {@link VaultStatus} minus the resume cursor, which is an internal
 * rewrap detail with no operator meaning.
 */
export interface ConsoleVaultBuiltinStatus {
  /** Whether `oke vault init` has run against this backend. */
  readonly initialized: boolean;
  /**
   * Whether the Console process can open secrets. The built-in store keeps
   * the master key in memory per process, so this is `true` whenever
   * `OKE_VAULT_MASTER_KEY` is absent — even if another process is unsealed.
   */
  readonly sealed: boolean;
  /** Whether a master-key record exists in the backend. */
  readonly masterKeyPresent: boolean;
  /** KEK generation new writes are wrapped under. */
  readonly kekVersion: number;
  /** Live (non-deleted) secret paths. */
  readonly secretCount: number;
  /** Seals since initialization. */
  readonly sealCount: number;
  /** Epoch-ms of the last seal, or `null`. */
  readonly lastSealedAt: number | null;
  /** Epoch-ms of the last unseal, or `null`. */
  readonly lastUnsealedAt: number | null;
  /** KEK generation an in-flight master rotation is migrating toward. */
  readonly rewrapTargetKekVersion: number | null;
}

/**
 * Which backend terminates the resolution chain, and its state.
 *
 * Only the built-in `vault` driver has a seal lifecycle to report; every
 * other driver surfaces its id alone so the operator still knows where the
 * last layer reads from.
 */
export interface ConsoleVaultBackend {
  /** `drivers.vault` id resolved for the current environment. */
  readonly driverId: VaultDriverId;
  /** Whether {@link driverId} is okengine's own encrypted-at-rest store. */
  readonly builtin: boolean;
  /** Backend status — `null` for non-builtin drivers or when unreachable. */
  readonly status: ConsoleVaultBuiltinStatus | null;
  /** Why {@link status} is missing for a builtin backend; `null` otherwise. */
  readonly unavailable: string | null;
  /** Managed provider id (`aws-secrets-manager`); `null` otherwise. */
  readonly provider: string | null;
}

/**
 * Per-layer values for Manifest vault boot (seeded Console).
 *
 * `driver` lands on the backend bag. File / env overlays are memory bags
 * with the spec source ids so resolution can show a winner per layer
 * without writing the project's `.env.local`.
 */
export interface VaultLayerSeed {
  readonly driver?: Readonly<Record<string, string>>;
  readonly processEnv?: Readonly<Record<string, string>>;
  readonly envLocal?: Readonly<Record<string, string>>;
  readonly devFallback?: Readonly<Record<string, string>>;
}

/** Overlay sources that sit after the driver in the spec chain. */
const VAULT_OVERLAY_SOURCES = ["process.env", ".env.local"] as const;

/**
 * Insert memory bags for seeded file / env layers (same source ids).
 *
 * @param chain - Boot chain from {@link buildVaultBootChain}
 * @param overlays - Values keyed by spec source
 */
export function overlayVaultLayers(
  chain: readonly VaultChainLayer[],
  overlays: Partial<
    Record<(typeof VAULT_OVERLAY_SOURCES)[number], Readonly<Record<string, string>>>
  >,
): VaultChainLayer[] {
  const out = [...chain];
  for (const source of VAULT_OVERLAY_SOURCES) {
    const secrets = overlays[source];
    if (secrets === undefined || Object.keys(secrets).length === 0) continue;
    const layer: VaultChainLayer = {
      driver: memoryVaultDriver,
      source,
      options: { secrets },
    };
    const idx = out.findIndex((l) => l.source === source);
    if (idx === -1) out.push(layer);
    else out.splice(idx, 0, layer);
  }
  return out;
}

/** Options when projecting the vault list. */
export interface ProjectVaultOptions {
  readonly manifest: Manifest | null;
  readonly runtime: VaultRuntime | null;
  /** Current process environment label. */
  readonly env?: VaultEnvLabel;
  /** Backend badge from {@link probeVaultBackend}; `null` when unprobed. */
  readonly backend?: ConsoleVaultBackend | null;
  /**
   * Optional peer-environment fingerprints (e.g. staging from a remote
   * probe). Never values — fingerprints only.
   */
  readonly peerFingerprints?: Readonly<Record<string, VaultFingerprintsByEnv>>;
  /** Durable journal — blast radius is queried, not estimated. */
  readonly journal?: JournalStore | null;
  readonly now?: () => number;
  /** Project root — loads `.oke/vault-contracts.json` when set. */
  readonly cwd?: string;
  /** Preloaded Console overlay (tests). */
  readonly overlay?: readonly VaultOverlayContract[];
}

/**
 * Project Manifest vault contracts into operator rows.
 *
 * @param options - Manifest, runtime, journal
 */
export async function projectVaultList(options: ProjectVaultOptions): Promise<{
  readonly secrets: readonly ConsoleVaultRow[];
  readonly env: VaultEnvLabel;
  readonly backend: ConsoleVaultBackend | null;
}> {
  const env = options.env ?? "dev";
  const now = options.now ?? (() => Date.now());
  const overlay =
    options.overlay ?? (options.cwd !== undefined ? await loadVaultOverlay(options.cwd) : []);
  const names = collectNames(options.manifest, options.runtime, overlay);
  const journalRuns = options.journal
    ? await options.journal.list()
    : ([] as readonly JournalRun[]);

  const secrets: ConsoleVaultRow[] = [];
  for (const name of names) {
    const contract = contractOf(name, options.manifest, options.runtime, overlay);
    const sensitive = contract.sensitive;
    const readers = readersOf(options.manifest, name);
    const blastRadius = blastRadiusOf(journalRuns, readers, now());
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

    const sharedFingerprintEnvs = sensitive ? sharedEnvs(fingerprints, env, fingerprint) : [];

    secrets.push({
      name,
      kind: contract.kind,
      sensitive,
      ...(contract.description !== undefined ? { description: contract.description } : {}),
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
      origin: options.manifest?.vault?.[name] ? "source" : overlay.some((c) => c.name === name)
        ? "console"
        : "source",
    });
  }

  return { secrets, env, backend: options.backend ?? null };
}

/**
 * Environment variable holding the base64 master key. Mirrors the driver's
 * own constant so the probe stays free of a static `drivers/` import.
 */
const VAULT_MASTER_KEY_ENV = "OKE_VAULT_MASTER_KEY";

/**
 * Resolve `drivers.vault` for an environment, falling back to the framework
 * defaults (`env` in dev, `memory` in test, the built-in store in prod).
 *
 * @param config - Loaded `oke.config`, when available
 * @param env - Active config environment
 */
export function resolveVaultDriverId(
  config: OkeConfig | null | undefined,
  env: ConfigEnv,
): VaultDriverId {
  const raw = resolveDriverId(config?.drivers?.vault, env, VAULT_DEFAULTS);
  if (raw === undefined) return "env";
  try {
    return normalizeVaultDriverId(raw);
  } catch {
    // An unknown id is a boot concern; the Console still renders the list.
    return "env";
  }
}

/** Options for {@link probeVaultBackend}. */
export interface ProbeVaultBackendOptions {
  /** Loaded `oke.config` — supplies `drivers.vault`. */
  readonly config?: OkeConfig | null;
  /** Active config environment (default `dev`). */
  readonly env?: ConfigEnv;
  /** Process environment for SQL URL / master-key capability (default `process.env`). */
  readonly processEnv?: Readonly<Record<string, string | undefined>>;
  /**
   * Status source. Injected by tests; by default the built-in adapter is
   * opened *sealed* over the configured SQL URL, so the probe never unseals
   * and never writes an unseal audit row.
   */
  readonly loadStatus?: () => Promise<VaultStatus>;
}

/**
 * Report which backend serves the terminal chain layer, plus its state when
 * that backend is the built-in store.
 *
 * The Console never holds the master key on the operator's behalf: the probe
 * reads backend facts only, and reports `sealed` from whether this process
 * has `OKE_VAULT_MASTER_KEY` at all.
 *
 * @param options - Config / env / status source
 */
export async function probeVaultBackend(
  options: ProbeVaultBackendOptions = {},
): Promise<ConsoleVaultBackend> {
  const env = options.env ?? "dev";
  const driverId = resolveVaultDriverId(options.config, env);
  const processEnv = options.processEnv ?? process.env;
  const provider = managedProviderOf(driverId, processEnv);
  if (driverId !== "vault") {
    return { driverId, builtin: false, status: null, unavailable: null, provider };
  }

  const keyHeld = (processEnv[VAULT_MASTER_KEY_ENV] ?? "").trim().length > 0;

  const load = options.loadStatus ?? defaultBuiltinStatusLoader(processEnv);
  if (!load) {
    return {
      driverId,
      builtin: true,
      status: null,
      unavailable: "No SQL URL configured — set DATABASE_URL or OKE_STORE_SQL_URL",
      provider,
    };
  }

  try {
    const status = await load();
    return {
      driverId,
      builtin: true,
      status: { ...toConsoleVaultStatus(status), sealed: !keyHeld },
      unavailable: null,
      provider,
    };
  } catch (error) {
    // Uninitialized / unreachable is an ordinary operator state, not a crash.
    return {
      driverId,
      builtin: true,
      status: null,
      unavailable: error instanceof Error ? error.message : String(error),
      provider,
    };
  }
}

/**
 * Provider id for the managed driver, when set.
 *
 * @param driverId - Resolved vault driver
 * @param processEnv - Process environment
 */
function managedProviderOf(
  driverId: VaultDriverId,
  processEnv: Readonly<Record<string, string | undefined>>,
): string | null {
  if (driverId !== "managed") return null;
  const raw = processEnv.OKE_VAULT_PROVIDER?.trim();
  return raw && raw.length > 0 ? raw : null;
}

/** Operator-safe audit row (epoch-ms timestamps, no chain hashes). */
export interface ConsoleVaultAuditRow {
  readonly id: string;
  readonly seq: number;
  readonly action: string;
  readonly path: string | null;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly success: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly requestId: string | null;
  readonly createdAt: number;
}

/** `GET /console/vault/audit/verify` body. */
export interface ConsoleVaultAuditVerifyResult {
  readonly ok: boolean;
  readonly brokenAt: string | null;
  readonly reason: AuditChainBreakReason | null;
  readonly row: ConsoleVaultAuditRow | null;
}

/** `POST /console/vault/rotate-master` success body (minus `at`). */
export interface ConsoleVaultRotateMasterResult {
  readonly kekVersion: number;
  readonly remaining: number;
  readonly masterKey: string | null;
}

/** In-process master-rotation handle — process-global, not session-scoped. */
export interface ConsoleVaultRotateHandle {
  readonly adapter: import("../../elements/vault/builtin-adapter.ts").BuiltinVaultAdapter;
  close(): Promise<void>;
  inFlight: boolean;
}

/** Options for {@link openConsoleBuiltinAdapter}. */
export interface OpenConsoleBuiltinAdapterOptions {
  readonly config?: OkeConfig | null;
  readonly env?: ConfigEnv;
  readonly processEnv?: Readonly<Record<string, string | undefined>>;
  /** When true, unseal from `OKE_VAULT_MASTER_KEY`. Verify stays sealed. */
  readonly unseal: boolean;
  readonly kekRewrapBatchSize?: number;
}

/** Opened built-in adapter for Console operator actions. */
export interface OpenedConsoleBuiltinAdapter {
  readonly adapter: import("../../elements/vault/builtin-adapter.ts").BuiltinVaultAdapter;
  close(): Promise<void>;
}

/**
 * Open the built-in Vault adapter for Console verify / rotate-master.
 *
 * Never accepts a master key in the HTTP body. Unseal uses
 * `OKE_VAULT_MASTER_KEY` only when {@link OpenConsoleBuiltinAdapterOptions.unseal}
 * is true.
 *
 * @param options - Config / env / unseal
 */
export async function openConsoleBuiltinAdapter(
  options: OpenConsoleBuiltinAdapterOptions,
): Promise<OpenedConsoleBuiltinAdapter> {
  const env = options.env ?? "dev";
  const driverId = resolveVaultDriverId(options.config, env);
  if (driverId !== "vault") {
    throw new ConsoleVaultUnsupportedError(
      `vault: backend ${driverId} has no seal lifecycle or master rotation`,
    );
  }
  const processEnv = options.processEnv ?? process.env;
  const url = processEnv.DATABASE_URL ?? processEnv.OKE_STORE_SQL_URL;
  if (url === undefined || url.trim().length === 0) {
    throw new ConsoleVaultUnsupportedError(
      "No SQL URL configured — set DATABASE_URL or OKE_STORE_SQL_URL",
    );
  }
  const keyHeld = (processEnv[VAULT_MASTER_KEY_ENV] ?? "").trim().length > 0;
  if (options.unseal && !keyHeld) {
    throw new ConsoleVaultSealedError(
      "This process holds no master key — export OKE_VAULT_MASTER_KEY or run `oke vault unseal`",
    );
  }
  const { openBuiltinVaultAdapter } = await import("../../drivers/vault-builtin.ts");
  const opened = await openBuiltinVaultAdapter({
    url,
    env: processEnv,
    masterKey: options.unseal ? (processEnv[VAULT_MASTER_KEY_ENV] ?? "") : "",
    ...(options.kekRewrapBatchSize === undefined
      ? {}
      : { kekRewrapBatchSize: options.kekRewrapBatchSize }),
  });
  return {
    adapter: opened.adapter,
    close: () => opened.close(),
  };
}

/**
 * Verify the audit chain (sealed — no master key).
 *
 * @param options - Config / env
 */
export async function verifyConsoleVaultAudit(
  options: Omit<OpenConsoleBuiltinAdapterOptions, "unseal"> = {},
): Promise<ConsoleVaultAuditVerifyResult> {
  const opened = await openConsoleBuiltinAdapter({ ...options, unseal: false });
  try {
    const result = await opened.adapter.verifyAudit();
    if (result.ok || result.brokenAt === undefined) {
      return { ok: true, brokenAt: null, reason: null, row: null };
    }
    const record = await opened.adapter.readAuditRow(result.brokenAt);
    return {
      ok: false,
      brokenAt: result.brokenAt,
      reason: result.reason ?? null,
      row: record ? toConsoleVaultAuditRow(record) : null,
    };
  } finally {
    await opened.close();
  }
}

/**
 * Convert an adapter audit row into the JSON-safe Console shape.
 *
 * @param row - Adapter record
 */
export function toConsoleVaultAuditRow(row: VaultAuditRecord): ConsoleVaultAuditRow {
  return {
    id: row.id,
    seq: row.seq,
    action: row.action,
    path: row.path,
    actorType: row.actorType,
    actorId: row.actorId,
    success: row.success,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    requestId: row.requestId,
    createdAt: row.createdAt.getTime(),
  };
}

/** Built-in backend is missing or not the `vault` driver. */
export class ConsoleVaultUnsupportedError extends Error {
  readonly code = "VaultUnsupported" as const;
  /**
   * @param message - Secret-free reason
   */
  constructor(message: string) {
    super(message);
    this.name = "ConsoleVaultUnsupportedError";
  }
}

/** This process has no master key. */
export class ConsoleVaultSealedError extends Error {
  readonly code = "VaultSealed" as const;
  /**
   * @param message - Secret-free reason
   */
  constructor(message: string) {
    super(message);
    this.name = "ConsoleVaultSealedError";
  }
}

/** Lease held, batch in flight, or cold-resume required. */
export class ConsoleVaultRotateBusyError extends Error {
  readonly code = "VaultRotateBusy" as const;
  /**
   * @param message - Secret-free reason
   */
  constructor(message: string) {
    super(message);
    this.name = "ConsoleVaultRotateBusyError";
  }
}

/**
 * Map adapter / Console vault errors onto typed Console failures.
 *
 * @param error - Caught error
 */
export function mapConsoleVaultError(error: unknown): never {
  if (error instanceof ConsoleVaultSealedError) throw error;
  if (error instanceof ConsoleVaultRotateBusyError) throw error;
  if (error instanceof ConsoleVaultUnsupportedError) throw error;
  if (error instanceof VaultError) {
    if (error.code === "SEALED") throw new ConsoleVaultSealedError(error.message);
    if (
      error.code === "UNSUPPORTED" &&
      /lease held|already in progress|no master rotation|resume rotate-master/i.test(error.message)
    ) {
      throw new ConsoleVaultRotateBusyError(error.message);
    }
    throw new ConsoleVaultUnsupportedError(error.message);
  }
  throw error instanceof Error ? error : new Error(String(error));
}

/**
 * Convert an adapter {@link VaultStatus} into the JSON-safe Console shape.
 *
 * @param status - Adapter status
 */
export function toConsoleVaultStatus(status: VaultStatus): ConsoleVaultBuiltinStatus {
  return {
    initialized: status.initialized,
    sealed: status.sealed,
    masterKeyPresent: status.masterKeyPresent,
    kekVersion: status.kekVersion,
    secretCount: status.secretCount,
    sealCount: status.sealCount,
    lastSealedAt: status.lastSealedAt?.getTime() ?? null,
    lastUnsealedAt: status.lastUnsealedAt?.getTime() ?? null,
    rewrapTargetKekVersion: status.rewrapTargetKekVersion ?? null,
  };
}

/**
 * Build the default status loader: open the built-in adapter sealed over the
 * configured SQL URL. Returns `null` when no SQL is configured — spinning up
 * a throwaway PGlite instance would report an empty vault that does not exist.
 *
 * @param processEnv - Environment supplying the SQL URL
 */
function defaultBuiltinStatusLoader(
  processEnv: Readonly<Record<string, string | undefined>>,
): (() => Promise<VaultStatus>) | null {
  const url = processEnv.DATABASE_URL ?? processEnv.OKE_STORE_SQL_URL;
  if (url === undefined || url.trim().length === 0) return null;
  return async () => {
    const { openBuiltinVaultAdapter } = await import("../../drivers/vault-builtin.ts");
    // `masterKey: ""` keeps the adapter sealed — status needs no unseal.
    const opened = await openBuiltinVaultAdapter({ url, env: processEnv, masterKey: "" });
    try {
      return await opened.adapter.status();
    } finally {
      await opened.close();
    }
  };
}

/** Input for set / rotate. */
export interface VaultWriteInput {
  readonly name: string;
  readonly value: string;
}

/** Input for Console Add (new contract + value). */
export interface VaultCreateInput {
  readonly name: string;
  readonly value: string;
  readonly kind: "secret" | "config";
  readonly description?: string;
  readonly rotate?: string;
}

/**
 * Declare a contract from Console and write its value.
 *
 * Persists metadata under `.oke/vault-contracts.json`. The value goes
 * through {@link VaultRuntime.put} (same as Set). Does not invent
 * undeclared `process.env` names.
 *
 * @param runtime - Bound vault runtime
 * @param cwd - Project root
 * @param manifest - Manifest (rejects names already declared in source)
 * @param input - Name + kind + value
 */
export async function createVaultContract(
  runtime: VaultRuntime,
  cwd: string,
  manifest: Manifest | null,
  input: VaultCreateInput,
): Promise<{ readonly name: string; readonly fingerprint: string | null }> {
  const name = input.name.trim();
  if (!isVaultContractName(name)) {
    throw new Error(`vault: invalid contract name "${input.name}"`);
  }
  if (manifest?.vault?.[name] || runtime.contracts.has(name)) {
    throw new Error(`vault: "${name}" is already declared — use Set`);
  }
  const overlay = await loadVaultOverlay(cwd);
  if (overlay.some((c) => c.name === name)) {
    throw new Error(`vault: "${name}" is already declared — use Set`);
  }
  const rotate = input.rotate?.trim();
  const description = input.description?.trim();
  const contract: VaultOverlayContract = {
    name,
    kind: input.kind,
    ...(description !== undefined && description.length > 0 ? { description } : {}),
    ...(rotate !== undefined && rotate.length > 0 ? { rotate } : {}),
  };
  await upsertVaultOverlay(cwd, contract);
  const decl: VaultSecretDecl =
    input.kind === "config"
      ? declareVault.config(name, {
          ...(description !== undefined && description.length > 0 ? { description } : {}),
          ...(rotate !== undefined && rotate.length > 0 ? { rotate } : {}),
          sensitive: false,
        })
      : declareVault.secret(name, {
          ...(description !== undefined && description.length > 0 ? { description } : {}),
          ...(rotate !== undefined && rotate.length > 0 ? { rotate } : {}),
          sensitive: true,
        });
  (runtime.contracts as Map<string, VaultSecretDecl>).set(name, decl);
  return setVaultValue(runtime, { name, value: input.value });
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
    fingerprint: runtime.isSensitive(input.name) ? (runtime.fingerprint(input.name) ?? null) : null,
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
 * Uses the standard resolution chain: driver → process.env → .env.local →
 * (optional) dev fallback. Does not parse dotenv in the UI.
 *
 * @param manifest - Manifest snapshot (null when only Console overlay exists)
 * @param options - cwd / env / allowDevFallbacks / seed / overlays
 */
export async function createManifestVaultRuntime(
  manifest: Manifest | null,
  options: {
    readonly cwd?: string;
    readonly env?: ConfigEnv;
    readonly allowDevFallbacks?: boolean;
    readonly seed?: Readonly<Record<string, string>>;
    /**
     * Memory bags inserted at the spec source (seeded Console). Does not
     * write `.env.local` on disk.
     */
    readonly overlays?: Partial<
      Record<(typeof VAULT_OVERLAY_SOURCES)[number], Readonly<Record<string, string>>>
    >;
    /** `dev` fallbacks for `vault.config` contracts (dev-fallback layer). */
    readonly devFallbacks?: Readonly<Record<string, string>>;
    readonly now?: () => number;
    /**
     * Backend driver for the terminal layer. Defaults to the built-in
     * `vault` store when `drivers.vault` is not consulted.
     */
    readonly driverId?: VaultDriverId;
  } = {},
): Promise<VaultRuntime | null> {
  const cwd = options.cwd ?? process.cwd();
  const overlay = await loadVaultOverlay(cwd);
  const entries = Object.entries(manifest?.vault ?? {});
  if (entries.length === 0 && overlay.length === 0) return null;

  const seen = new Set<string>();
  const secrets: VaultSecretDecl[] = entries.map(([name, c]) => {
    seen.add(name);
    const sensitive = c.sensitive !== false;
    const dev = options.devFallbacks?.[name];
    if (sensitive) {
      return declareVault.secret(name, {
        description: c.description,
        rotate: c.rotate,
        schema: c.schema,
        sensitive: true,
        ...(dev !== undefined ? { dev } : {}),
      });
    }
    return declareVault.config(name, {
      description: c.description,
      rotate: c.rotate,
      schema: c.schema,
      sensitive: false,
      ...(dev !== undefined ? { dev } : {}),
    });
  });
  for (const row of overlay) {
    if (seen.has(row.name)) continue;
    const dev = options.devFallbacks?.[row.name];
    secrets.push(
      row.kind === "config"
        ? declareVault.config(row.name, {
            description: row.description,
            rotate: row.rotate,
            sensitive: false,
            ...(dev !== undefined ? { dev } : {}),
          })
        : declareVault.secret(row.name, {
            description: row.description,
            rotate: row.rotate,
            sensitive: true,
            ...(dev !== undefined ? { dev } : {}),
          }),
    );
  }

  const seed = options.seed ?? {};
  const env = options.env ?? "dev";
  // Soft-fallback to memory when the backend is unreachable — the Console
  // must never fail to list contracts because a vault is missing.
  const runtime = createVaultRuntime({
    secrets,
    allowDevFallbacks: options.allowDevFallbacks ?? env !== "prod",
    now: options.now,
    chain: overlayVaultLayers(
      buildVaultBootChain({
        cwd,
        driverId: options.driverId ?? "vault",
        env: env === "dev" || env === "test" || env === "prod" ? env : "dev",
        seed,
      }),
      options.overlays ?? {},
    ),
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
    (r) => r.status === "sleeping" && r.wakeAt != null && readers.has(r.flow),
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
export function readersOf(manifest: Manifest | null, name: string): readonly string[] {
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
  overlay: readonly VaultOverlayContract[] = [],
): readonly string[] {
  const set = new Set<string>();
  for (const name of Object.keys(manifest?.vault ?? {})) set.add(name);
  if (runtime) {
    for (const name of runtime.contracts.keys()) set.add(name);
  }
  for (const row of overlay) set.add(row.name);
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
  overlay: readonly VaultOverlayContract[] = [],
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
      ...(fromRuntime.description !== undefined ? { description: fromRuntime.description } : {}),
      ...(fromRuntime.rotate !== undefined ? { rotate: fromRuntime.rotate } : {}),
    };
  }
  const fromManifest = manifest?.vault?.[name];
  if (fromManifest) {
    const sensitive = fromManifest.sensitive !== false;
    return {
      kind: sensitive ? "secret" : "config",
      sensitive,
      ...(fromManifest.description !== undefined ? { description: fromManifest.description } : {}),
      ...(fromManifest.rotate !== undefined ? { rotate: fromManifest.rotate } : {}),
    };
  }
  const fromOverlay = overlay.find((c) => c.name === name);
  if (fromOverlay) {
    return {
      kind: fromOverlay.kind,
      sensitive: fromOverlay.kind === "secret",
      ...(fromOverlay.description !== undefined ? { description: fromOverlay.description } : {}),
      ...(fromOverlay.rotate !== undefined ? { rotate: fromOverlay.rotate } : {}),
    };
  }
  return { kind: "secret", sensitive: true };
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
export function assertNoSecretLeak(row: ConsoleVaultRow, knownSecrets: readonly string[]): void {
  const blob = JSON.stringify(row);
  for (const secret of knownSecrets) {
    if (secret.length === 0) continue;
    if (blob.includes(secret)) {
      throw new Error(`vault console leak: secret value appears in row for ${row.name}`);
    }
  }
}
