/**
 * Vault runtime — resolution chain, boot validation, redaction, fingerprints.
 */

import type { VaultBag, VaultDriver } from "../../drivers/vault-types.ts";
import { fromDockerRole, isFromDocker } from "./declare.ts";
import type { VaultSecretDecl } from "./declare.ts";
import { fingerprintSecretSync } from "./fingerprint.ts";
import { createSecretRedactor, SECRET_MASK } from "./redact.ts";

/** One missing secret reported at boot. */
export interface VaultGap {
  readonly name: string;
  readonly description?: string;
}

/**
 * Boot failure listing every missing secret at once.
 */
export class VaultBootError extends Error {
  /** All gaps discovered in a single pass. */
  readonly gaps: readonly VaultGap[];

  /**
   * @param gaps - Missing secrets
   */
  constructor(gaps: readonly VaultGap[]) {
    const lines = gaps.map((g) => `  - ${g.name}${g.description ? `: ${g.description}` : ""}`);
    super(`vault boot failed — ${gaps.length} missing secret(s):\n${lines.join("\n")}`);
    this.name = "VaultBootError";
    this.gaps = gaps;
  }
}

/**
 * Named layer in the resolution chain (console §9.8).
 * Spec order: process.env → .env.local → .env.docker → driver → dev-fallback.
 */
export type VaultResolutionSource =
  | "process.env"
  | ".env.local"
  | ".env.docker"
  | "driver"
  | "dev-fallback";

/** One layer in the resolution chain. */
export interface VaultChainLayer {
  /** Driver to open. */
  readonly driver: VaultDriver;
  /** Open options for this layer. */
  readonly options?: Parameters<VaultDriver["open"]>[0];
  /**
   * Spec source id for Console resolution display.
   * When omitted, inferred from driver id + `options.path`.
   */
  readonly source?: VaultResolutionSource;
}

/** One layer's outcome for a single contract (Console resolution chain). */
export interface VaultResolutionStep {
  readonly source: VaultResolutionSource;
  /** Whether this layer had a non-empty value for the name. */
  readonly present: boolean;
  /** Whether this layer supplied the winning value. */
  readonly won: boolean;
}

/** Options for {@link createVaultRuntime}. */
export interface CreateVaultRuntimeOptions {
  /** Declared secret / config contracts. */
  readonly secrets?: readonly VaultSecretDecl[];
  /**
   * Resolution chain — first hit wins.
   * Callers pass the env-appropriate layers (env / openbao / memory / …).
   */
  readonly chain?: readonly VaultChainLayer[];
  /**
   * When true, use each contract's `dev` fallback before reporting a gap.
   * Never enable in production boot.
   */
  readonly allowDevFallbacks?: boolean;
  /** Clock for last-read timestamps (tests). */
  readonly now?: () => number;
}

/** Vault runtime surface. */
export interface VaultRuntime {
  /** Declared contracts by name. */
  readonly contracts: ReadonlyMap<string, VaultSecretDecl>;
  /**
   * Driver ids of each chain layer in order (`env` · `openbao` · `memory` · `managed`).
   * Available before {@link boot}.
   */
  readonly chainDriverIds: readonly string[];
  /**
   * Open every chain layer, merge (first wins), validate all contracts,
   * register redaction. Throws {@link VaultBootError} listing every gap.
   */
  boot(): Promise<void>;
  /** Whether {@link boot} has succeeded. */
  readonly booted: boolean;
  /**
   * Read a secret (capability is enforced by `fx.vault`).
   * Records {@link lastReadAt}.
   *
   * @param name - Secret name
   */
  read(name: string): string;
  /**
   * Write / overwrite a secret on the first mutable bag (subject keys).
   *
   * @param name - Secret name
   * @param value - Cleartext
   */
  put(name: string, value: string): void;
  /**
   * Delete a secret (crypto-shred). Returns whether a key was removed.
   *
   * @param name - Secret name
   */
  delete(name: string): boolean;
  /**
   * Fingerprint for Console / traces (never the value).
   * Always defined for loaded secrets; `undefined` if not loaded.
   *
   * @param name - Secret name
   */
  fingerprint(name: string): string | undefined;
  /**
   * Cleartext for non-sensitive config only. Secrets always return
   * `undefined` — Console must never call this expecting a secret.
   *
   * @param name - Contract name
   */
  cleartext(name: string): string | undefined;
  /** Whether the contract is sensitive (fingerprinted, never revealed). */
  isSensitive(name: string): boolean;
  /**
   * Which resolution source won for this name.
   *
   * @param name - Contract name
   */
  resolution(name: string): VaultResolutionSource | undefined;
  /**
   * Full resolution chain for a name — every consulted layer with
   * present/won flags (console §9.8).
   *
   * @param name - Contract name
   */
  resolutionChain(name: string): readonly VaultResolutionStep[];
  /**
   * Epoch-ms of the last {@link read} (exposes dead secrets).
   *
   * @param name - Contract name
   */
  lastReadAt(name: string): number | undefined;
  /**
   * Redact secret values from a log/trace payload.
   *
   * @param value - Arbitrary structured data or string
   */
  redact(value: unknown): unknown;
  /** Redact a free-form string. */
  redactString(input: string): string;
  /** All loaded secret names. */
  names(): readonly string[];
  /** Close underlying bags. */
  close(): Promise<void>;
}

/**
 * Create a Vault runtime.
 *
 * @param options - Contracts + resolution chain
 */
export function createVaultRuntime(options: CreateVaultRuntimeOptions = {}): VaultRuntime {
  const contracts = new Map<string, VaultSecretDecl>();
  for (const s of options.secrets ?? []) {
    contracts.set(s.name, s);
  }

  const now = options.now ?? (() => Date.now());
  let booted = false;
  let merged = new Map<string, string>();
  let bags: VaultBag[] = [];
  let layerSources: VaultResolutionSource[] = [];
  /** name → source → present */
  let presence = new Map<string, Map<VaultResolutionSource, boolean>>();
  let winners = new Map<string, VaultResolutionSource>();
  let lastReads = new Map<string, number>();
  let redactor = createSecretRedactor([]);

  async function boot(): Promise<void> {
    bags = [];
    merged = new Map();
    layerSources = [];
    presence = new Map();
    winners = new Map();
    const chain = options.chain ?? [];

    for (const layer of chain) {
      const source = resolveLayerSource(layer);
      layerSources.push(source);
      const bag = await layer.driver.open(layer.options);
      bags.push(bag);
      for (const name of bag.names()) {
        markPresent(presence, name, source);
        if (!merged.has(name)) {
          const v = bag.get(name);
          if (v !== undefined && v.length > 0) {
            merged.set(name, v);
            winners.set(name, source);
          }
        }
      }
    }

    if (options.allowDevFallbacks) {
      for (const c of contracts.values()) {
        if (c.dev !== undefined && !merged.has(c.name)) {
          const resolved = resolveDevFallback(c.dev);
          if (resolved !== undefined && resolved.length > 0) {
            markPresent(presence, c.name, "dev-fallback");
            merged.set(c.name, resolved);
            winners.set(c.name, "dev-fallback");
          }
        }
      }
    }

    const gaps: VaultGap[] = [];
    for (const c of contracts.values()) {
      const value = merged.get(c.name);
      if (value === undefined || value.length === 0) {
        gaps.push({
          name: c.name,
          ...(c.description !== undefined ? { description: c.description } : {}),
        });
      }
    }
    if (gaps.length > 0) {
      throw new VaultBootError(gaps);
    }

    // Redact only sensitive values — config may appear in logs as intended.
    const sensitiveValues = [...merged.entries()]
      .filter(([name]) => isSensitiveName(contracts, name))
      .map(([, v]) => v);
    redactor = createSecretRedactor(sensitiveValues);
    booted = true;
  }

  const chainDriverIds = (options.chain ?? []).map((layer) => layer.driver.id);

  return {
    contracts,
    chainDriverIds,
    get booted() {
      return booted;
    },
    boot,
    read(name) {
      if (!booted) {
        throw new Error(`vault: read("${name}") before boot`);
      }
      const value = merged.get(name);
      if (value === undefined) {
        throw new Error(`vault: secret "${name}" is not loaded`);
      }
      lastReads.set(name, now());
      return value;
    },
    put(name, value) {
      if (!booted) {
        throw new Error(`vault: put("${name}") before boot`);
      }
      const idx = bags.findIndex((b) => typeof b.set === "function");
      if (idx < 0) {
        throw new Error("vault: no mutable bag for put()");
      }
      const writable = bags[idx];
      writable?.set?.(name, value);
      merged.set(name, value);
      const source = layerSources[idx] ?? "driver";
      markPresent(presence, name, source);
      winners.set(name, source);
      const sensitiveValues = [...merged.entries()]
        .filter(([n]) => isSensitiveName(contracts, n))
        .map(([, v]) => v);
      redactor = createSecretRedactor(sensitiveValues);
    },
    delete(name) {
      if (!booted) {
        throw new Error(`vault: delete("${name}") before boot`);
      }
      let deleted = false;
      for (const bag of bags) {
        if (typeof bag.delete === "function" && bag.delete(name)) {
          deleted = true;
        }
      }
      if (merged.delete(name)) deleted = true;
      winners.delete(name);
      lastReads.delete(name);
      if (deleted) {
        const sensitiveValues = [...merged.entries()]
          .filter(([n]) => isSensitiveName(contracts, n))
          .map(([, v]) => v);
        redactor = createSecretRedactor(sensitiveValues);
      }
      return deleted;
    },
    fingerprint(name) {
      const value = merged.get(name);
      if (value === undefined) return undefined;
      if (!isSensitiveName(contracts, name)) return undefined;
      return fingerprintSecretSync(value);
    },
    cleartext(name) {
      if (isSensitiveName(contracts, name)) return undefined;
      return merged.get(name);
    },
    isSensitive(name) {
      return isSensitiveName(contracts, name);
    },
    resolution(name) {
      return winners.get(name);
    },
    resolutionChain(name) {
      const steps: VaultResolutionStep[] = [];
      const seen = new Set<VaultResolutionSource>();
      const winner = winners.get(name);
      for (const source of layerSources) {
        if (seen.has(source)) continue;
        seen.add(source);
        const present = presence.get(name)?.get(source) === true;
        steps.push({
          source,
          present,
          won: winner === source,
        });
      }
      if (options.allowDevFallbacks && !seen.has("dev-fallback")) {
        const present = presence.get(name)?.get("dev-fallback") === true;
        steps.push({
          source: "dev-fallback",
          present,
          won: winner === "dev-fallback",
        });
      }
      return steps;
    },
    lastReadAt(name) {
      return lastReads.get(name);
    },
    redact(value) {
      return redactor.redact(value);
    },
    redactString(input) {
      return redactor.redactString(input);
    },
    names() {
      return [...merged.keys()];
    },
    async close() {
      for (const bag of bags) {
        await bag.close?.();
      }
      bags = [];
      merged = new Map();
      layerSources = [];
      presence = new Map();
      winners = new Map();
      lastReads = new Map();
      redactor = createSecretRedactor([]);
      booted = false;
    },
  };
}

/**
 * Infer the Console source id for a chain layer.
 *
 * @param layer - Chain layer
 */
export function resolveLayerSource(layer: VaultChainLayer): VaultResolutionSource {
  if (layer.source) return layer.source;
  const path = layer.options?.path;
  if (typeof path === "string") {
    if (path.endsWith(".env.local") || path.includes("/.env.local")) {
      return ".env.local";
    }
    if (path.endsWith(".env.docker") || path.includes("/.env.docker")) {
      return ".env.docker";
    }
  }
  if (layer.driver.id === "env" && path === undefined) {
    return "process.env";
  }
  return "driver";
}

/**
 * Resolve a `dev` fallback, expanding {@link import("./declare.ts").fromDocker}
 * markers via docker env (`OKE_<ROLE>_URL`) without teaching the kernel
 * image-specific env-var names.
 *
 * @param dev - Declared fallback
 */
function resolveDevFallback(dev: string): string | undefined {
  if (!isFromDocker(dev)) return dev;
  const role = fromDockerRole(dev);
  const key = `OKE_${role.replaceAll(".", "_").toUpperCase()}_URL`;
  const fromEnv =
    (typeof Bun !== "undefined" ? Bun.env[key] : undefined) ??
    process.env[key] ??
    (role === "store.sql"
      ? ((typeof Bun !== "undefined" ? Bun.env.DATABASE_URL : undefined) ??
        process.env.DATABASE_URL)
      : undefined);
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  // Local/test without `oke dev --docker`: still satisfy url-shaped contracts.
  if (role === "store.sql") return "postgres://localhost/oke";
  return undefined;
}

/**
 * @param contracts - Declared contracts
 * @param name - Contract name
 */
function isSensitiveName(contracts: ReadonlyMap<string, VaultSecretDecl>, name: string): boolean {
  const c = contracts.get(name);
  if (!c) return true;
  return c.sensitive;
}

/**
 * @param presence - Presence map
 * @param name - Contract name
 * @param source - Layer source
 */
function markPresent(
  presence: Map<string, Map<VaultResolutionSource, boolean>>,
  name: string,
  source: VaultResolutionSource,
): void {
  let row = presence.get(name);
  if (!row) {
    row = new Map();
    presence.set(name, row);
  }
  row.set(source, true);
}

export { SECRET_MASK };
