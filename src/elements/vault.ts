/**
 * Vault element — protected knowledge.
 *
 * Physics: secrets · config · environment.
 * Drivers: `sops` (Typage/age) · `env` · `openbao` · `infisical` · `managed`.
 *
 * A declaration is a contract, never a value. Boot validates every contract
 * and lists all gaps at once. Logs/traces receive fingerprints and redaction
 * registered at boot — cleartext never appears even when passed to `fx.log`.
 */

export {
  vault,
  fromStack,
  FROM_STACK_PREFIX,
  isFromStack,
  fromStackRole,
} from "./vault/declare.ts";
export type {
  VaultSecretDecl,
  VaultSecretOptions,
} from "./vault/declare.ts";

export {
  createVaultRuntime,
  VaultBootError,
  SECRET_MASK,
} from "./vault/runtime.ts";
export type {
  CreateVaultRuntimeOptions,
  VaultChainLayer,
  VaultGap,
  VaultRuntime,
} from "./vault/runtime.ts";

export {
  fingerprintSecret,
  fingerprintSecretSync,
} from "./vault/fingerprint.ts";

export { createSecretRedactor } from "./vault/redact.ts";
