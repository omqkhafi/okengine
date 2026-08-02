/**
 * Shared Vault resolution-chain assembly for app boot and Console.
 *
 * Order (first hit wins): process.env → .env.local → compose .env.docker →
 * backend layer (`env` seed / openbao / memory / managed).
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ConfigEnv } from "../../config/index.ts";
import {
  envVaultDriver,
  managedVaultDriver,
  memoryVaultDriver,
  openbaoVaultDriver,
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
  /** Active config env — controls fail-loud vs soft fallback for openbao. */
  readonly env?: ConfigEnv;
  /** Seed secrets for the terminal memory / managed layer. */
  readonly seed?: Readonly<Record<string, string>>;
  /**
   * When `openbao` is selected but credentials are missing:
   * - `"throw"` — fail loud (default for `prod` / `docker`)
   * - `"memory"` — soft-fallback to a seeded memory bag (Console / local)
   */
  readonly missingOpenbao?: "throw" | "memory";
}

/**
 * Normalize a config label to a {@link VaultDriverId}.
 *
 * Accepts legacy `"dotenv"` as an alias for `"env"`.
 *
 * @param raw - Config string
 */
export function normalizeVaultDriverId(raw: string): VaultDriverId {
  if (raw === "dotenv") return "env";
  if (raw === "env" || raw === "openbao" || raw === "memory" || raw === "managed") {
    return raw;
  }
  throw new Error(
    `oke boot: unknown vault driver "${raw}" (expected env · openbao · memory · managed)`,
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
  const openbaoUrl = process.env.OKE_VAULT_URL ?? envMap.get("OKE_VAULT_URL");
  const openbaoToken = process.env.OKE_VAULT_TOKEN ?? envMap.get("OKE_VAULT_TOKEN");
  const openbaoMount = process.env.OKE_VAULT_MOUNT ?? envMap.get("OKE_VAULT_MOUNT") ?? "secret";

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
    case "managed":
      return [
        {
          driver: managedVaultDriver,
          source: "driver",
          options: { secrets: seed },
        },
      ];
    case "env":
      return [
        ...envLayers,
        {
          driver: memoryVaultDriver,
          source: "driver",
          options: { secrets: seed },
        },
      ];
    case "openbao": {
      if (openbaoUrl && openbaoToken) {
        return [
          ...envLayers,
          {
            driver: openbaoVaultDriver,
            source: "driver",
            options: { url: openbaoUrl, token: openbaoToken, mount: openbaoMount },
          },
        ];
      }
      const env = options.env ?? "local";
      const missing =
        options.missingOpenbao ?? (env === "prod" || env === "docker" ? "throw" : "memory");
      if (missing === "throw") {
        throw new Error(
          'oke boot: vault driver "openbao" needs OKE_VAULT_URL and OKE_VAULT_TOKEN ' +
            "(did `oke dev -d` bootstrap OpenBao / write docker/.env.docker?)",
        );
      }
      return [
        ...envLayers,
        {
          driver: memoryVaultDriver,
          source: "driver",
          options: { secrets: seed },
        },
      ];
    }
    default: {
      const _exhaustive: never = options.driverId;
      throw new Error(`oke boot: unhandled vault driver ${String(_exhaustive)}`);
    }
  }
}
