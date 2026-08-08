/**
 * Lazy vault binder — loaded only when secrets are declared.
 */

import { resolveDriverId, type ConfigEnv } from "../../config/index.ts";
import { VAULT_DEFAULTS } from "../../config/driver-defaults.ts";
import { createVaultRuntime, type VaultRuntime } from "../../elements/vault.ts";
import { buildVaultBootChain, normalizeVaultDriverId } from "../../elements/vault/boot-chain.ts";
import type { BootOptions } from "../boot.ts";

/**
 * Resolve `drivers.vault` for the active env (default `env` locally, `memory` in test).
 *
 * @param options - Boot options
 * @param env - Active environment
 */
export function resolveVaultDriverId(options: BootOptions, env: ConfigEnv): string {
  // Defaults cover every ConfigEnv key, so this is never undefined.
  return resolveDriverId(options.config?.drivers?.vault, env, VAULT_DEFAULTS)!;
}

/**
 * Construct and boot a Vault runtime from BootOptions.
 *
 * Uses `drivers.vault` via the shared {@link buildVaultBootChain} helper
 * (same chain Console uses). Injected `options.vault.chain` still wins for tests.
 *
 * @param options - Boot options
 * @param env - Active environment
 */
export async function bindVault(options: BootOptions, env: ConfigEnv): Promise<VaultRuntime> {
  const vaultSecrets = options.vault?.secrets ?? options.secrets ?? [];
  const chain =
    options.vault?.chain ??
    buildVaultBootChain({
      driverId: normalizeVaultDriverId(resolveVaultDriverId(options, env)),
      env,
      cwd: process.cwd(),
      seed: {},
    });
  const vault = createVaultRuntime({
    secrets: vaultSecrets,
    chain,
    allowDevFallbacks: options.vault?.allowDevFallbacks ?? env !== "prod",
    now: options.vault?.now,
  });
  await vault.boot();
  return vault;
}
