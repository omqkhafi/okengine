/**
 * Example-only: put keel's stub contracts into the built-in vault.
 *
 * Other apps leave Vault empty. Keel seeds so Console `/vault` shows
 * `driver` after a fresh `oke dev` + seed — not `.env.local` / `dev-fallback`.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  openBuiltinVaultAdapter,
  VAULT_MASTER_KEY_ENV,
  type OpenedBuiltinVault,
} from "okengine/drivers";
import { KEEL_VAULT } from "@/core";
import { regroupKeelEnvLocal } from "../../../scripts/reset.ts";

/**
 * Stub values written into the built-in vault on `oke db seed` (dev).
 * Same strings as each contract's `dev` fallback.
 */
export const KEEL_VAULT_SEED: Readonly<Record<string, string>> = Object.fromEntries(
  KEEL_VAULT.flatMap((contract) =>
    contract.dev !== undefined && contract.dev.length > 0 ? [[contract.name, contract.dev]] : [],
  ),
);

/** Options for {@link seedKeelVault}. */
export interface SeedKeelVaultOptions {
  /** Project root that owns `.env.local` (defaults to `process.cwd()`). */
  readonly root?: string;
  /** Log line writer. */
  readonly write?: (text: string) => void;
  /**
   * Pre-opened adapter (tests). Caller closes it.
   * When omitted, opens from `DATABASE_URL` / `OKE_STORE_SQL_URL`.
   */
  readonly opened?: OpenedBuiltinVault;
  /** Env map for the master key. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** Outcome of {@link seedKeelVault}. */
export interface SeedKeelVaultResult {
  /** Whether this call created the store (first boot). */
  readonly initialized: boolean;
  /** Contract names written this call. */
  readonly written: readonly string[];
  /** Contract names already present (left alone). */
  readonly skipped: readonly string[];
}

/**
 * Initialize the built-in vault when needed, persist the master key, and
 * fill missing keel contracts. Never overwrites a value already in the store.
 *
 * @param options - Root / adapter / env seams
 */
export async function seedKeelVault(
  options: SeedKeelVaultOptions = {},
): Promise<SeedKeelVaultResult> {
  const root = options.root ?? process.cwd();
  const write = options.write ?? ((text) => process.stdout.write(text));
  const env = options.env ?? process.env;
  const owned = options.opened === undefined;
  const opened =
    options.opened ??
    (await openBuiltinVaultAdapter({
      env,
      masterKey: "",
    }));

  try {
    const adapter = opened.adapter;
    const status = await adapter.status();
    let initialized = false;
    let masterKey = trimKey(env[VAULT_MASTER_KEY_ENV]) ?? (await readMasterKeyFromEnvLocal(root));

    if (!status.initialized) {
      const init = await adapter.initialize();
      masterKey = init.masterKey;
      await persistMasterKey(root, masterKey);
      if (env === process.env) process.env[VAULT_MASTER_KEY_ENV] = masterKey;
      await adapter.unseal(masterKey);
      initialized = true;
      write("oke db seed: initialized built-in vault\n");
    } else if (status.sealed) {
      if (masterKey === undefined) {
        write(
          `oke db seed: vault initialized but ${VAULT_MASTER_KEY_ENV} is missing — skip vault seed\n`,
        );
        return { initialized: false, written: [], skipped: Object.keys(KEEL_VAULT_SEED) };
      }
      await adapter.unseal(masterKey);
    }

    const existing = new Set((await adapter.list()).map((entry) => entry.path));
    const written: string[] = [];
    const skipped: string[] = [];
    for (const [name, value] of Object.entries(KEEL_VAULT_SEED)) {
      if (existing.has(name)) {
        skipped.push(name);
        continue;
      }
      await adapter.set(name, value, { actor: { type: "system", id: "oke.db.seed" } });
      written.push(name);
    }
    if (written.length > 0) {
      write(`oke db seed: wrote ${written.length} vault contract(s)\n`);
    }
    return { initialized, written, skipped };
  } finally {
    if (owned) await opened.close();
  }
}

/**
 * Read `OKE_VAULT_MASTER_KEY` from `.env.local` when process env is empty.
 *
 * @param root - Project root
 */
export async function readMasterKeyFromEnvLocal(root: string): Promise<string | undefined> {
  let text = "";
  try {
    text = await readFile(join(root, ".env.local"), "utf8");
  } catch {
    return undefined;
  }
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) !== VAULT_MASTER_KEY_ENV) continue;
    return trimKey(trimmed.slice(eq + 1));
  }
  return undefined;
}

/**
 * Write `OKE_VAULT_MASTER_KEY` into `.env.local` and regroup sections.
 *
 * @param root - Project root
 * @param key - Base64 master key
 */
export async function persistMasterKey(root: string, key: string): Promise<void> {
  const path = join(root, ".env.local");
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch {
    text = "";
  }
  const line = `${VAULT_MASTER_KEY_ENV}=${key}`;
  const re = new RegExp(`^#?\\s*${VAULT_MASTER_KEY_ENV}=.*$`, "m");
  const next = re.test(text)
    ? text.replace(re, line)
    : `${text.trimEnd()}${text.trimEnd().length > 0 ? "\n" : ""}${line}\n`;
  await writeFile(path, next, "utf8");
  await regroupKeelEnvLocal(root);
}

function trimKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
