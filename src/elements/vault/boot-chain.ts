/**
 * Shared Vault resolution-chain assembly for app boot and Console.
 *
 * Spec order (first hit wins): driver (vault / managed) → process.env →
 * .env.local. Runtime appends `dev-fallback` last.
 *
 * The `env` driver has no backend bag — a read-only memory seed sits in
 * front (same `driver` source id) so the lock-path matches vault/managed.
 * Console writes still persist to `.env.local` (first writable env file).
 * Same chain for every {@link ConfigEnv}; no per-environment special-casing.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ConfigEnv } from "../../config/index.ts";
import {
  builtinVaultDriver,
  envVaultDriver,
  managedVaultDriver,
  memoryVaultDriver,
} from "../../drivers/index.ts";
import { parseDotenv } from "../../drivers/vault-dotenv-parse.ts";
import type { VaultDriverId } from "../../drivers/vault-types.ts";
import { resolveComposeEnvPath } from "./chain.ts";
import type { VaultChainLayer } from "./runtime.ts";

/** Options for {@link buildVaultBootChain}. */
export interface BuildVaultBootChainOptions {
  /** Project root (defaults to `process.cwd()`). */
  readonly cwd?: string;
  /** Resolved `drivers.vault` id for the active env. */
  readonly driverId: VaultDriverId;
  /** Active config env. */
  readonly env?: ConfigEnv;
  /** Seed secrets for the terminal memory / managed layer. */
  readonly seed?: Readonly<Record<string, string>>;
}

/**
 * Normalize a config label to a {@link VaultDriverId}.
 *
 * Accepts legacy `"dotenv"` as an alias for `"env"`, and `"builtin"` as an
 * alias for the built-in `"vault"` store.
 *
 * @param raw - Config string
 */
export function normalizeVaultDriverId(raw: string): VaultDriverId {
  if (raw === "dotenv") return "env";
  if (raw === "builtin") return "vault";
  if (raw === "env" || raw === "vault" || raw === "memory" || raw === "managed") {
    return raw;
  }
  throw new Error(
    `oke boot: unknown vault driver "${raw}" (expected env · vault · memory · managed). ` +
      'Official backends: built-in vault (drivers.vault: "vault"), ENV, or managed with ' +
      "aws-secrets-manager · azure-key-vault · gcp-secret-manager · doppler · 1password.",
  );
}

/**
 * Build the standard Vault resolution chain for app boot / Console.
 *
 * @param options - Driver id + cwd + seed
 */
export function buildVaultBootChain(options: BuildVaultBootChainOptions): VaultChainLayer[] {
  const cwd = options.cwd ?? process.cwd();
  const seed = options.seed ?? {};
  const composeEnv = resolveComposeEnvPath(cwd);

  let composeText = "";
  if (existsSync(composeEnv.path)) {
    composeText = readFileSync(composeEnv.path, "utf8").toString();
  }
  const envMap = parseDotenv(composeText);
  const vaultUrl = process.env.OKE_VAULT_URL ?? envMap.get("OKE_VAULT_URL");
  const vaultToken = process.env.OKE_VAULT_TOKEN ?? envMap.get("OKE_VAULT_TOKEN");
  const vaultMount = process.env.OKE_VAULT_MOUNT ?? envMap.get("OKE_VAULT_MOUNT");
  const vaultProvider = process.env.OKE_VAULT_PROVIDER ?? envMap.get("OKE_VAULT_PROVIDER");
  const vaultRegion = process.env.OKE_VAULT_REGION ?? envMap.get("OKE_VAULT_REGION");

  const envLayers: VaultChainLayer[] = [
    { driver: envVaultDriver, source: "process.env" },
    {
      driver: envVaultDriver,
      source: ".env.local",
      options: { path: resolve(cwd, ".env.local") },
    },
  ];

  switch (options.driverId) {
    case "memory":
      return [
        {
          driver: memoryVaultDriver,
          source: "driver",
          options: { secrets: seed },
        },
      ];
    case "managed": {
      // No provider: the platform injected the values as env vars, so the
      // driver's own env+seed bag is the whole chain.
      if (vaultProvider === undefined || vaultProvider === "") {
        return [
          {
            driver: managedVaultDriver,
            source: "driver",
            options: { secrets: seed },
          },
        ];
      }
      // Remote provider: the managed bag is first so a value already in
      // the backend wins over a leftover `process.env` / dotenv pin.
      return [
        {
          driver: managedVaultDriver,
          source: "driver",
          options: {
            provider: vaultProvider,
            secrets: seed,
            ...(vaultUrl === undefined ? {} : { url: vaultUrl }),
            ...(vaultToken === undefined ? {} : { token: vaultToken }),
            ...(vaultMount === undefined ? {} : { mount: vaultMount }),
            ...(vaultRegion === undefined ? {} : { region: vaultRegion }),
          },
        },
        ...envLayers,
      ];
    }
    case "env":
      return [
        {
          driver: memoryVaultDriver,
          source: "driver",
          options: { secrets: seed },
        },
        ...envLayers,
      ];
    case "vault":
      // Built-in store is first: a value already in Vault wins over
      // `process.env` / dotenv. `put()` lands on this bag.
      return [
        {
          driver: builtinVaultDriver,
          source: "driver",
          options: { secrets: seed },
        },
        ...envLayers,
      ];
    default: {
      const _exhaustive: never = options.driverId;
      throw new Error(`oke boot: unhandled vault driver ${String(_exhaustive)}`);
    }
  }
}
