/**
 * Vault element — protected knowledge.
 *
 * Physics: secrets · config · environment.
 * Drivers: `env` · `vault` · `managed` · `memory`.
 *
 * A declaration is a contract, never a value. Boot validates every contract
 * and lists all gaps at once. Logs/traces receive fingerprints and redaction
 * registered at boot — cleartext never appears even when passed to `fx.log`.
 * @module
 */

export {
  vault,
  vaultEnvApi,
  fromDocker,
  FROM_DOCKER_PREFIX,
  isFromDocker,
  fromDockerRole,
  listRequiredEnvNames,
  readEnv,
  resetRequiredEnvNames,
} from "./vault/declare.ts";
export type { VaultEnvApi, VaultSecretDecl, VaultSecretOptions } from "./vault/declare.ts";

export {
  createVaultRuntime,
  VaultBootError,
  SECRET_MASK,
  requiredEnvGaps,
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

export { COMPOSE_ENV_REL, resolveComposeEnvPath } from "./vault/chain.ts";

export { VaultError, isVaultError } from "./vault/errors.ts";
export type { VaultErrorCode } from "./vault/errors.ts";

export { canonicalizePath, MAX_VAULT_PATH_LENGTH } from "./vault/path.ts";
export type {
  MasterKeySource,
  VaultActor,
  VaultActorType,
  VaultAdapter,
  VaultAlgorithm,
  VaultAuditConfig,
  VaultAuditSinkKind,
  VaultElementConfig,
  VaultEncryptionConfig,
  VaultGetOptions,
  VaultInitResult,
  VaultListEntry,
  VaultListOptions,
  VaultManagedConfig,
  VaultSealConfig,
  VaultSecret,
  VaultSetOptions,
  VaultStatus,
} from "./vault/types.ts";

export {
  BACKUP_MAGIC,
  createBuiltinVaultAdapter,
  DEFAULT_KEK_REWRAP_BATCH_SIZE,
  sqlConnectionAsExec,
} from "./vault/builtin-adapter.ts";
export type {
  BuiltinVaultAdapter,
  CreateBuiltinVaultOptions,
  VaultRotateMasterResult,
} from "./vault/builtin-adapter.ts";

export {
  createAuditSink,
  createNullAuditSink,
  computeAuditRowHash,
  AUDIT_GENESIS_HASH,
} from "./vault/audit.ts";
export type { AuditAction, AuditEntry, AuditSink, AuditWriter } from "./vault/audit.ts";

export {
  createSqlAuditWriter,
  ensureVaultTables,
  purgeAuditBefore,
  purgeExpiredSecrets,
  readAuditPage,
  verifyAuditChain,
  VAULT_DDL_STATEMENTS,
} from "./vault/storage.ts";
export type {
  AuditChainResult,
  AuditPageOptions,
  PurgeExpiredResult,
  SqlExec,
  VaultAuditRecord,
} from "./vault/storage.ts";

export {
  createResilientSqlExec,
  DEFAULT_RETRY,
  isRetryableError,
  withResilience,
} from "./vault/resilience.ts";
export type { RetryConfig } from "./vault/resilience.ts";

export {
  createEnvUnsealer,
  createFileUnsealer,
  createMemoryUnsealer,
  createUnsealerFromBase64,
} from "./vault/unseal.ts";
export type { Unsealer } from "./vault/unseal.ts";

export { createAwsKmsUnsealer, wrapMasterWithAwsKms } from "./vault/kms-unseal.ts";
export type {
  CreateAwsKmsUnsealerOptions,
  WrapMasterWithAwsKmsOptions,
} from "./vault/kms-unseal.ts";

export { fingerprintSecret, fingerprintSecretSync } from "./vault/fingerprint.ts";

export { createSecretRedactor } from "./vault/redact.ts";
