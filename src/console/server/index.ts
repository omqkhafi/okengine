/**
 * Console server — flows, live channel, Manifest feed, security.
 */

export {
  accessCreateKey,
  accessRevokeKey,
  accessRotateKey,
  accessUpdateKey,
  accessSetRoleGrants,
  effectivePermissions,
  expandAccessCeiling,
  isKeyUnused90d,
  keyBlastRadius,
  KEY_UNUSED_MS,
  projectAccessPanel,
  residualAccessNote,
  type AccessEffectivePermissions,
  type AccessHygiene,
  type AccessKeyBlastRadius,
  type AccessKeyRow,
  type AccessPanelProjection,
  type AccessPlaneSection,
  type AccessScopeProvenance,
  type ProjectAccessOptions,
} from "./access.ts";
export {
  bindManifestClockRuntime,
  bindManifestSignalBus,
  bindManifestStoreRuntime,
  bindManifestVaultRuntime,
  bootConsoleApp,
  createConsoleApp,
  ensureConsolePanelRuntimes,
  wrapConsoleRunsForLive,
  type ConsoleApp,
  type ConsoleAppHandle,
  type CreateConsoleAppOptions,
} from "./app.ts";
export {
  aggregateWaitingOn,
  createManifestClockRuntime,
  flowIdsForCronRow,
  projectClocksList,
  projectWaitingOn,
  type ConsoleClockList,
  type ConsoleClockRow,
  type ConsoleTimelineEvent,
  type ConsoleWaitingOnRow,
  type ProjectClocksOptions,
  type WaitingOnCount,
} from "./clock.ts";
export { bindHostFleetStores, listConsoleInstances } from "./instances.ts";
export {
  blastRadiusOf,
  createManifestVaultRuntime,
  overlayVaultLayers,
  projectVaultList,
  readersOf,
  createVaultContract,
  rotateVaultValue,
  setVaultValue,
  verifyConsoleVaultAudit,
  type ConsoleVaultAuditRow,
  type ConsoleVaultAuditVerifyResult,
  type ConsoleVaultBlastRadius,
  type ConsoleVaultRotateMasterResult,
  type ConsoleVaultRow,
  type VaultLayerSeed,
  type ProjectVaultOptions,
  type VaultCreateInput,
  type VaultWriteInput,
} from "./vault.ts";
export {
  CLAIM_CODE_FILE,
  CLAIM_RATE_LIMIT,
  CLAIM_RATE_WINDOW_MS,
  CLAIM_TTL_MS,
  claimCodeArtifactPath,
  clearClaimCodeArtifact,
  constantTimeEqual,
  mintClaimCode,
  printClaimCodeOnce,
  readClaimCodeArtifact,
  verifyClaimCode,
  writeClaimCodeArtifact,
  type ClaimCodeArtifact,
  type ClaimCodeState,
  type ClaimVerifyResult,
  type ReadClaimCodeArtifactResult,
} from "./claim.ts";
export {
  CONSOLE_PG_SCHEMA,
  consoleTable,
  openConsolePersistence,
  resolveConsoleSecret,
  type ConsolePersistence,
  type OpenConsolePersistenceOptions,
} from "./operator-db.ts";
export { createConsoleBindings } from "./flows.ts";
export { PUBLIC_CONSOLE_FLOWS } from "./public-flows.ts";
export {
  createLiveWebsocket,
  feedManifest,
  feedRun,
  subscribeLive,
  type ConsoleLiveData,
} from "./live.ts";
export { appendHostRunToConsole, handleRunsIngest, RUNS_INGEST_PATH } from "./runs-ingest.ts";
export { consolePlugin } from "./plugin.ts";
export {
  CONSOLE_COOKIES,
  CONSOLE_CSP,
  CONSOLE_VITE_DEV_CSP,
  PLUGIN_FRAME_CSP,
  PLUGIN_IFRAME_SANDBOX,
  consoleSessionCookie,
  withConsoleSecurityHeaders,
} from "./security-headers.ts";
export {
  attachSessionCookies,
  isConsoleKernelPath,
  isConsoleSpaPath,
  proxySpa,
  serveConsole,
  startConsoleApp,
  withCookieAuth,
  type ConsoleServerHandle,
  type ServeConsoleOptions,
} from "./serve.ts";
export {
  createConsoleState,
  publishLive,
  setManifest,
  type ConsoleIdentity,
  type ConsoleLiveMessage,
  type ConsoleLiveRun,
  type ConsoleLiveRunEffect,
  type ConsoleLiveRunLog,
  type ConsoleState,
  type CreateConsoleStateOptions,
} from "./state.ts";
export {
  createFileDiff,
  emitStructuralDiff,
  type EmitStructuralDiffOptions,
  type StructuralProposal,
} from "./structural.ts";
export {
  countRunsByFlowLastWeek,
  formatBlastLine,
  formatRunCount,
  formatWeeklyBill,
  projectManifestDiff,
  weeklyCostDeltaUsd,
  WEEK_MS,
  type ConsoleDiffChange,
  type ConsoleDiffProjection,
  type DiffCiGate,
  type ProjectManifestDiffOptions,
} from "./diff.ts";
export {
  filterCapabilityDiffForPlugin,
  groupPluginChanges,
  loadCapabilityDiffByPlugin,
  PLUGIN_STATE_DERIVATION,
  projectPluginsList,
  type ConsolePluginRow,
  type ConsolePluginsList,
  type PluginCapabilityChange,
  type PluginInterceptView,
  type PluginScopeView,
  type PluginState,
  type ProjectPluginsOptions,
} from "./plugins.ts";
