/**
 * Shared Vault resolution-chain assembly for app boot and Console.
 *
 * Order (first hit wins): process.env → .env.local → compose .env.docker →
 * backend layer (`env` seed / vault / memory / managed).
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
      'provider "aws-secrets-manager".',
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
    {
      driver: envVaultDriver,
      source: composeEnv.source,
      options: { path: composeEnv.path },
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
      // With a remote provider the bag is remote-only, so the env layers go
      // in front — an operator override in `process.env` still wins.
      return [
        ...envLayers,
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
      ];
    }
    case "env":
      return [
        ...envLayers,
        {
          driver: memoryVaultDriver,
          source: "driver",
          options: { secrets: seed },
        },
      ];
    case "vault":
      // The built-in store sits behind the env layers: an operator override
      // in `process.env` still wins, exactly as it does for every driver.
      return [
        ...envLayers,
        {
          driver: builtinVaultDriver,
          source: "driver",
          options: { secrets: seed },
        },
      ];
    default: {
      const _exhaustive: never = options.driverId;
      throw new Error(`oke boot: unhandled vault driver ${String(_exhaustive)}`);
    }
  }
}
