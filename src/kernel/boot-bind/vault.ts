/**
 * Lazy vault binder — loaded only when secrets are declared.
 */

import { memoryVaultDriver } from "../../drivers/vault-memory.ts";
import {
  createVaultRuntime,
  type VaultRuntime,
} from "../../elements/vault.ts";
import type { ConfigEnv } from "../../config/index.ts";
import type { BootOptions } from "../boot.ts";

/**
 * Construct and boot a Vault runtime from BootOptions.
 *
 * @param options - Boot options
 * @param env - Active environment
 */
export async function bindVault(
  options: BootOptions,
  env: ConfigEnv,
): Promise<VaultRuntime> {
  const vaultSecrets = options.vault?.secrets ?? options.secrets ?? [];
  const vault = createVaultRuntime({
    secrets: vaultSecrets,
    chain: options.vault?.chain ?? [
      {
        driver: memoryVaultDriver,
        options: { secrets: {} },
      },
    ],
    allowDevFallbacks: options.vault?.allowDevFallbacks ?? env !== "prod",
  });
  await vault.boot();
  return vault;
}
