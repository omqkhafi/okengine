/**
 * Example-only: put keel contracts into the built-in vault (prod posture).
 *
 * Other apps leave Vault empty. Keel seeds so Console `/vault` shows
 * `driver` after a fresh `oke dev` + seed. Stack URLs are copied from the
 * minted `.env.local` / process env. `OKE_VAULT_MASTER_KEY` and `PORT` stay
 * in env — they unseal the store and bind the process.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FROM_DOCKER_PREFIX } from "okengine";
import {
  openBuiltinVaultAdapter,
  VAULT_MASTER_KEY_ENV,
  type OpenedBuiltinVault,
} from "okengine/drivers";
import { KEEL_VAULT } from "@/core";
import { regroupKeelEnvLocal } from "../../../scripts/reset.ts";

/** Compose writes the Meili key as `OKE_STORE_INDEX_KEY`, not `MEILI_MASTER_KEY`. */
const ENV_ALIASES: Readonly<Record<string, readonly string[]>> = {
  MEILI_MASTER_KEY: ["OKE_STORE_INDEX_KEY"],
};

/**
 * Stub values (static `dev` fallbacks only — not `vault.fromDocker` markers).
 */
export const KEEL_VAULT_SEED: Readonly<Record<string, string>> = resolveKeelVaultSeedValues({});

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
  /** Env map for the master key and stack URLs. Defaults to `process.env`. */
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
 * Resolve seed values: process env / `.env.local` first, then a static `dev`
 * fallback. `vault.fromDocker` markers are not written — those need Compose.
 *
 * @param env - Process env
 * @param envLocal - Parsed `.env.local`
 */
export function resolveKeelVaultSeedValues(
  env: Readonly<Record<string, string | undefined>>,
  envLocal: ReadonlyMap<string, string> = new Map(),
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const contract of KEEL_VAULT) {
    const fromEnv = firstEnvValue(contract.name, env, envLocal);
    if (fromEnv !== undefined) {
      out[contract.name] = fromEnv;
      continue;
    }
    const dev = contract.dev;
    if (dev !== undefined && dev.length > 0 && !dev.startsWith(FROM_DOCKER_PREFIX)) {
      out[contract.name] = dev;
    }
  }
  return out;
}

function firstEnvValue(
  name: string,
  env: Readonly<Record<string, string | undefined>>,
  envLocal: ReadonlyMap<string, string>,
): string | undefined {
  const keys = [name, ...(ENV_ALIASES[name] ?? [])];
  for (const key of keys) {
    const value = trimKey(env[key]) ?? trimKey(envLocal.get(key));
    if (value !== undefined) return value;
  }
  return undefined;
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
  const envLocal = await readEnvLocal(root);
  const values = resolveKeelVaultSeedValues(env, envLocal);
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
    let masterKey =
      trimKey(env[VAULT_MASTER_KEY_ENV]) ?? trimKey(envLocal.get(VAULT_MASTER_KEY_ENV));

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
        return { initialized: false, written: [], skipped: Object.keys(values) };
      }
      await adapter.unseal(masterKey);
    }

    const existing = new Set((await adapter.list()).map((entry) => entry.path));
    const written: string[] = [];
    const skipped: string[] = [];
    for (const [name, value] of Object.entries(values)) {
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
 * Parse `.env.local` assignments (empty when the file is missing).
 *
 * @param root - Project root
 */
export async function readEnvLocal(root: string): Promise<Map<string, string>> {
  const values = new Map<string, string>();
  let text = "";
  try {
    text = await readFile(join(root, ".env.local"), "utf8");
  } catch {
    return values;
  }
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const value = trimKey(trimmed.slice(eq + 1));
    if (key.length > 0 && value !== undefined) values.set(key, value);
  }
  return values;
}

/**
 * Read `OKE_VAULT_MASTER_KEY` from `.env.local` when process env is empty.
 *
 * @param root - Project root
 */
export async function readMasterKeyFromEnvLocal(root: string): Promise<string | undefined> {
  const local = await readEnvLocal(root);
  return local.get(VAULT_MASTER_KEY_ENV);
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
