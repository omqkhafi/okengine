/**
 * Lazy vault binder — loaded only when secrets are declared.
 */

import {
  createVaultRuntime,
  defaultVaultResolutionChain,
  type VaultRuntime,
} from "../../elements/vault.ts";
import { resolveDriverId, type ConfigEnv } from "../../config/index.ts";
import type { BootOptions } from "../boot.ts";

/**
 * Construct and boot a Vault runtime from BootOptions.
 *
 * Default chain matches Console: process.env → .env.local → .env.docker →
 * driver (+ optional `dev:` fallback when allowed). When the config pin is
 * `sops`, the driver layer decrypts `secrets.enc.json` with age.
 *
 * @param options - Boot options
 * @param env - Active environment
 */
export async function bindVault(
  options: BootOptions,
  env: ConfigEnv,
): Promise<VaultRuntime> {
  const vaultSecrets = options.vault?.secrets ?? options.secrets ?? [];
  const cwd = process.cwd();
  const driverId = resolveDriverId(options.config?.drivers?.vault, env);
  const vault = createVaultRuntime({
    secrets: vaultSecrets,
    chain:
      options.vault?.chain ??
      defaultVaultResolutionChain(cwd, {
        ...(driverId !== undefined ? { driverId } : {}),
      }),
    allowDevFallbacks: options.vault?.allowDevFallbacks ?? env !== "prod",
    now: options.vault?.now,
  });
  await vault.boot();
  return vault;
}
