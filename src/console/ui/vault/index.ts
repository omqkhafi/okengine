/**
 * Vault panel pure modules (console §9.8).
 */

export type {
  VaultBackend,
  VaultBlastRadius,
  VaultBuiltinStatus,
  VaultDriverId,
  VaultKindGroup,
  VaultListResponse,
  VaultRecord,
  VaultResolutionSource,
  VaultResolutionStep,
} from "./types.ts";

export { formatVaultBackend, type VaultBackendBadge, type VaultBackendCard } from "./backend.ts";

export {
  VAULT_BACKEND_FIXTURE,
  VAULT_FIXTURE,
  VAULT_LIST_FIXTURE,
  FIXTURE_SECRET_VALUE,
} from "./fixture.ts";

export {
  parseVaultSearch,
  serializeVaultSearch,
  openVault,
  closeVault,
  type VaultSearch,
} from "./search.ts";

export { groupByKind, matchesQuery } from "./group.ts";

export {
  setConfirmation,
  rotateConfirmation,
  validateTypedConfirm,
  type ConfirmationPattern,
} from "./confirmation.ts";

export { formatBlastRadius, formatDuration } from "./blast-radius.ts";

export { dormantSecrets, DORMANT_MS } from "./dormant.ts";

export { exportSafeRow, exportSafeList, assertExportHasNoSecrets } from "./export-safe.ts";
