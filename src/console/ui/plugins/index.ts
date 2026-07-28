/**
 * Plugins panel pure modules (console §9.15).
 */

export { pluginCapabilityFindings, type PluginCapabilityFinding } from "./findings.ts";
export { copyCommandLabel, copyableCommand } from "./command.ts";
export { groupPlugins } from "./group.ts";
export {
  openPlugin,
  parsePluginsSearch,
  serializePluginsSearch,
  type PluginsSearch,
} from "./search.ts";
export { PLUGINS_LIST_FIXTURE, SUPPLY_CHAIN_COMMUNITY, SUPPLY_CHAIN_CORE_NA } from "./fixture.ts";
export type {
  BootConflictSignal,
  LifecycleScriptsSignal,
  NodeImportScanSignal,
  NpmProvenanceSignal,
  PluginCapabilityChangeRecord,
  PluginInterceptRecord,
  PluginOrigin,
  PluginRecord,
  PluginScopeRecord,
  PluginState,
  PluginsListGroup,
  PluginsListResponse,
  ReleaseCooldownSignal,
  SupplyChainRecord,
} from "./types.ts";
