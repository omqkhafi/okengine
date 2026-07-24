/**
 * Vault runtime — resolution chain, boot validation, redaction, fingerprints.
 */

import type { VaultBag, VaultDriver } from "../../drivers/vault-types.ts";
import { fromStackRole, isFromStack } from "./declare.ts";
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
    const lines = gaps.map(
      (g) =>
        `  - ${g.name}${g.description ? `: ${g.description}` : ""}`,
    );
    super(
      `vault boot failed — ${gaps.length} missing secret(s):\n${lines.join("\n")}`,
    );
    this.name = "VaultBootError";
    this.gaps = gaps;
  }
}

/** One layer in the resolution chain. */
export interface VaultChainLayer {
  /** Driver to open. */
  readonly driver: VaultDriver;
  /** Open options for this layer. */
  readonly options?: Parameters<VaultDriver["open"]>[0];
}

/** Options for {@link createVaultRuntime}. */
export interface CreateVaultRuntimeOptions {
  /** Declared secret contracts. */
  readonly secrets?: readonly VaultSecretDecl[];
  /**
   * Resolution chain — first hit wins.
   * Default for prod: `[sops]`; for tests callers pass memory/env layers.
   */
  readonly chain?: readonly VaultChainLayer[];
  /**
   * When true, use each contract's `dev` fallback before reporting a gap.
   * Never enable in production boot.
   */
  readonly allowDevFallbacks?: boolean;
}

/** Vault runtime surface. */
export interface VaultRuntime {
  /** Declared contracts by name. */
  readonly contracts: ReadonlyMap<string, VaultSecretDecl>;
  /**
   * Open every chain layer, merge (first wins), validate all contracts,
   * register redaction. Throws {@link VaultBootError} listing every gap.
   */
  boot(): Promise<void>;
  /** Whether {@link boot} has succeeded. */
  readonly booted: boolean;
  /**
   * Read a secret (capability is enforced by `fx.vault`).
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
   *
   * @param name - Secret name
   */
  fingerprint(name: string): string | undefined;
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
export function createVaultRuntime(
  options: CreateVaultRuntimeOptions = {},
): VaultRuntime {
  const contracts = new Map<string, VaultSecretDecl>();
  for (const s of options.secrets ?? []) {
    contracts.set(s.name, s);
  }

  let booted = false;
  let merged = new Map<string, string>();
  let bags: VaultBag[] = [];
  let redactor = createSecretRedactor([]);

  async function boot(): Promise<void> {
    bags = [];
    merged = new Map();
    const chain = options.chain ?? [];
    for (const layer of chain) {
      const bag = await layer.driver.open(layer.options);
      bags.push(bag);
      for (const name of bag.names()) {
        if (!merged.has(name)) {
          const v = bag.get(name);
          if (v !== undefined) merged.set(name, v);
        }
      }
    }

    if (options.allowDevFallbacks) {
      for (const c of contracts.values()) {
        if (c.dev !== undefined && !merged.has(c.name)) {
          const resolved = resolveDevFallback(c.dev);
          if (resolved !== undefined) merged.set(c.name, resolved);
        }
      }
    }

    const gaps: VaultGap[] = [];
    for (const c of contracts.values()) {
      const value = merged.get(c.name);
      if (value === undefined || value.length === 0) {
        gaps.push({
          name: c.name,
          ...(c.description !== undefined
            ? { description: c.description }
            : {}),
        });
      }
    }
    if (gaps.length > 0) {
      throw new VaultBootError(gaps);
    }

    redactor = createSecretRedactor(merged.values());
    booted = true;
  }

  return {
    contracts,
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
      return value;
    },
    put(name, value) {
      if (!booted) {
        throw new Error(`vault: put("${name}") before boot`);
      }
      const writable = bags.find((b) => typeof b.set === "function");
      if (!writable?.set) {
        throw new Error("vault: no mutable bag for put()");
      }
      writable.set(name, value);
      merged.set(name, value);
      redactor = createSecretRedactor(merged.values());
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
      if (deleted) {
        redactor = createSecretRedactor(merged.values());
      }
      return deleted;
    },
    fingerprint(name) {
      const value = merged.get(name);
      if (value === undefined) return undefined;
      return fingerprintSecretSync(value);
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
      redactor = createSecretRedactor([]);
      booted = false;
    },
  };
}

/**
 * Resolve a `dev` fallback, expanding {@link import("./declare.ts").fromStack}
 * markers via stack env (`OKE_<ROLE>_URL`) without teaching the kernel
 * image-specific env-var names.
 *
 * @param dev - Declared fallback
 */
function resolveDevFallback(dev: string): string | undefined {
  if (!isFromStack(dev)) return dev;
  const role = fromStackRole(dev);
  const key = `OKE_${role.replaceAll(".", "_").toUpperCase()}_URL`;
  const fromEnv =
    (typeof Bun !== "undefined" ? Bun.env[key] : undefined) ??
    process.env[key] ??
    (role === "store.sql"
      ? (typeof Bun !== "undefined" ? Bun.env.DATABASE_URL : undefined) ??
        process.env.DATABASE_URL
      : undefined);
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

export { SECRET_MASK };
