/**
 * Vault element — protected knowledge.
 *
 * Physics: secrets · config · environment.
 * Drivers: `sops` (Typage/age) · `env` · `infisical` · `managed`.
 *
 * A declaration is a contract, never a value. Boot validates every contract
 * and lists all gaps at once. Logs/traces receive fingerprints and redaction
 * registered at boot — cleartext never appears even when passed to `fx.log`.
 * @module
 */

export {
  vault,
  fromDocker,
  FROM_DOCKER_PREFIX,
  isFromDocker,
  fromDockerRole,
} from "./vault/declare.ts";
export type {
  VaultSecretDecl,
  VaultSecretOptions,
} from "./vault/declare.ts";

export {
  createVaultRuntime,
  VaultBootError,
  SECRET_MASK,
  resolveLayerSource,
} from "./vault/runtime.ts";
export type {
  CreateVaultRuntimeOptions,
  VaultChainLayer,
  VaultGap,
  VaultResolutionSource,
  VaultResolutionStep,
  VaultRuntime,
} from "./vault/runtime.ts";

export {
  defaultVaultResolutionChain,
  resolveAgeIdentity,
  resolveSopsPath,
  DEFAULT_SOPS_PATH,
  type DefaultVaultChainOptions,
} from "./vault/chain.ts";

export {
  ensureSopsScaffold,
  hasSopsBag,
  type SopsScaffoldResult,
} from "./vault/sops-scaffold.ts";

export {
  fingerprintSecret,
  fingerprintSecretSync,
} from "./vault/fingerprint.ts";

export { createSecretRedactor } from "./vault/redact.ts";
