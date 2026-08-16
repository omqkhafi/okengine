/**
 * Console server state — operators, sessions, claim code, Manifest snapshot.
 */

import {
  ACCESS_TTL_MS,
  createOperatorInviteStore,
  createOperatorStore,
  createSessionStore,
  type ApiKeyStore,
  type OperatorInviteStore,
  type OperatorStore,
  type RoleStore,
  type SessionStore,
} from "../../auth/index.ts";
import type {
  AccessEffectivePermissions,
  AccessKeyBlastRadius,
  AccessKeyRow,
  AccessPanelProjection,
} from "./access.ts";
import { deriveModuleActions, type GateRuntime } from "../../elements/gate.ts";
import type {
  SignalBus,
  SignalDiscardOptions,
  SignalReplayOptions,
  SignalReplayResult,
} from "../../drivers/signal-types.ts";
import type { AgentToolEffect, AiRuntime, EvalSuiteResult } from "../../elements/ai.ts";
import {
  createMemorySignalConfigStore,
  type SignalConfigStore,
} from "../../elements/signal/reconcile.ts";
import type { Manifest } from "../../manifest/types.ts";
import type { WideEvent } from "../../runs/types.ts";
import type { ConsoleRunsQueryResult } from "./runs-query.ts";
import type { ConsoleAiProjection } from "./ai.ts";
import { createLoginAttemptBag, type LoginAttemptBag } from "./auth-rate.ts";
import { mintClaimCode, type ClaimCodeState } from "./claim.ts";
import type { ConsoleSignalRow } from "./signals.ts";
import type {
  ConsoleStoreRow,
  StoreDeleteInput,
  StoreEditInput,
  StoreEditResult,
  StoreFileGetInput,
  StoreFileObject,
  StoreQueryInput,
  StoreQueryResult,
} from "./store.ts";
import type { ClockRuntime, EditScheduleInput } from "../../elements/clock.ts";
import type { StoreRuntime } from "../../elements/store.ts";
import type { VaultRuntime } from "../../elements/vault.ts";
import type { JournalStore } from "../../kernel/journal.ts";
import type { InstanceStore, InstancesList } from "../../kernel/instances.ts";
import type { CronStore } from "../../elements/clock/reconcile.ts";
import type { ResourceRef } from "../../manifest/types.ts";
import type { ConsoleClockList } from "./clock.ts";
import {
  createDefaultGateAuthStores,
  createManifestGateRuntime,
  type GatesPanelProjection,
  type SimulateGatesInput,
  type SimulateGatesResult,
} from "./gates.ts";
import {
  ConsoleVaultRotateBusyError,
  type ConsoleVaultAuditVerifyResult,
  type ConsoleVaultBackend,
  type ConsoleVaultRotateHandle,
  type ConsoleVaultRotateMasterResult,
  type ConsoleVaultRow,
  type VaultLayerSeed,
  type VaultCreateInput,
  type VaultWriteInput,
} from "./vault.ts";
import type { ChannelInbox } from "../../drivers/channel-types.ts";
import type { ChannelRuntime, TemplateCatalog } from "../../elements/channel.ts";
import type { ConsoleChannelPreview, ConsoleChannelsList, EmailAuthResult } from "./channels.ts";
import type { OkeConfig } from "../../config/index.ts";
import type { PluginRegistry } from "../../kernel/registry.ts";
import type { ConsolePluginsList } from "./plugins.ts";
import type { ConsoleDiffProjection } from "./diff.ts";
import { loadConsolePanel, type ConsolePanelId } from "./panel-load.ts";
import {
  isConsoleAuthStoreRef,
  queryConsoleAuthStore,
  rejectConsoleAuthMutation,
  requireConsoleAuthStore,
} from "./auth-store.ts";

/** How long a built-in Vault backend probe is reused across list polls. */
const VAULT_BACKEND_TTL_MS = 15_000;

/** User-plane identity row for the Flows invoke-as picker. */
export interface ConsoleIdentity {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly status: "active" | "disabled";
  readonly scopes: readonly string[];
}

/** Mutable Console runtime state for one process. */
export interface ConsoleState {
  readonly operators: OperatorStore;
  readonly sessions: SessionStore;
  readonly claim: ClaimCodeState;
  /** Auth HMAC secret (operator sessions). */
  readonly secret: string;
  /** Clock. */
  readonly now: () => number;
  /** Working-tree root for structural diffs. */
  readonly cwd: string;
  /** Latest Manifest snapshot fed to the live channel. */
  manifest: Manifest | null;
  /** Previous Manifest — for permission-widening deploy diff. */
  previousManifest: Manifest | null;
  /** Live-channel subscribers. */
  readonly liveSubscribers: Set<(msg: ConsoleLiveMessage) => void>;
  /**
   * Panel backends constructed on first access (lazy). Empty after
   * {@link createConsoleState}; grows as panels are visited.
   */
  readonly constructedPanels: ReadonlySet<ConsolePanelId>;
  /** Role store (data, not code) — Gates · Access. */
  readonly roles: RoleStore;
  /** API key store — first-class principals. */
  readonly apiKeys: ApiKeyStore;
  /** Operator invitations — Access hygiene. */
  readonly invites: OperatorInviteStore;
  /** Access-token TTL (ms) from auth config — residual revoke delay. */
  readonly accessTtlMs: number;
  /** roleId → member principal ids. */
  readonly roleMembers: Map<string, string[]>;
  /** Project Access panel (planes · grantable · hygiene). */
  listAccess: (actorScopes: Iterable<string>) => Promise<AccessPanelProjection>;
  /** Effective permissions with provenance. */
  accessEffective: (input: {
    readonly kind: "operator" | "user" | "role" | "key";
    readonly id: string;
  }) => Promise<AccessEffectivePermissions | null>;
  /** Blast radius for a key from Runs. */
  accessKeyBlast: (keyId: string) => Promise<AccessKeyBlastRadius>;
  /** Create an attenuated API key (secret once). */
  accessCreateKey: (input: {
    readonly plane: "user" | "operator";
    readonly name: string;
    readonly scopes: readonly string[];
    readonly creatorId: string;
    readonly creatorScopes: Iterable<string>;
    readonly expiresAt?: number | null;
    readonly rateLimit?: { max: number; per: string } | null;
    readonly ipAllowlist?: readonly string[];
  }) => Promise<{ readonly row: AccessKeyRow; readonly secret: string }>;
  /** Revoke a key (irreversible). */
  accessRevokeKey: (keyId: string) => Promise<AccessKeyRow | null>;
  /** Rotate a key secret (shown once). */
  accessRotateKey: (
    keyId: string,
  ) => Promise<{ readonly row: AccessKeyRow; readonly secret: string } | null>;
  /** Replace role grants (grantable scopes only). */
  accessSetRoleGrants: (input: {
    readonly roleId: string;
    readonly scopes: readonly string[];
    readonly actorScopes: Iterable<string>;
  }) => Promise<void>;
  /** Invite an operator. */
  accessCreateInvite: (input: {
    readonly email: string;
    readonly invitedBy: string;
  }) => Promise<{ readonly id: string; readonly email: string; readonly expiresAt: number }>;
  /**
   * Live GateRuntime from host boot (A). Bound after boot; Manifest
   * reconstruction is the Console-only fallback.
   */
  gateRuntime: GateRuntime | null;
  /** Project Gates panel (inquiry surfaces + audit + widenings). */
  listGates: () => Promise<GatesPanelProjection>;
  /** Evaluate-only simulator — never invokes the flow handler. */
  simulateGates: (input: SimulateGatesInput) => Promise<SimulateGatesResult>;
  /** Principal → powers (scopes + allowed flows). */
  powersForPrincipal: (input: {
    readonly kind: "role" | "key" | "user";
    readonly id: string;
  }) => Promise<{
    readonly scopes: readonly string[];
    readonly allowedFlowIds: readonly string[];
    readonly deniedFlowIds: readonly string[];
  }>;
  /** Bound after Console app boot — reads the runs store. */
  listRuns: () => Promise<WideEvent[]>;
  /**
   * Sandboxed SQL over persisted `.oke/runs` Parquet.
   * Bound after Console app boot; stub rejects until then.
   */
  queryPersistedRuns: (input: {
    readonly sql: string;
    readonly revealPii?: boolean;
    readonly timeoutMs?: number;
    readonly maxRows?: number;
  }) => Promise<ConsoleRunsQueryResult>;
  /**
   * Shared secret for host → Console WideEvent ingest (`oke dev` bridge).
   * `null` disables `POST /console/runs/ingest`.
   */
  readonly runsIngestSecret: string | null;
  /**
   * Optional host-app re-invoke for `console.traces.replay`.
   * When unset, the flow falls back to CLI-equivalent {@link runReplay}
   * against `cwd` (loads the app entry and re-executes with stored input).
   */
  replayTrace:
    | ((input: {
        readonly event: WideEvent;
        readonly dryRun: boolean;
      }) => Promise<{ readonly output: unknown; readonly failure?: unknown }>)
    | null;
  /**
   * Optional host-app invoke-as for `console.flows.invoke`.
   * When unset, invoke fails closed (`InvokeDenied`) — never stubs.
   */
  invokeUserFlow: import("./invoke-user-flow.ts").ConsoleInvokeUserFlow | null;
  /** Signal config store (`oke_signal_config`) — retains orphaned rows. */
  readonly signalConfig: SignalConfigStore;
  /**
   * Live signal bus. Bound after host app boot when available;
   * `null` until wired (list still returns reconciled Manifest rows).
   */
  signalBus: SignalBus | null;
  /** Project operator-plane signal rows (Manifest + bus + orphans). */
  listSignals: () => Promise<readonly ConsoleSignalRow[]>;
  /** Replay / dry-run via the real bus. */
  replaySignals: (options: SignalReplayOptions) => Promise<SignalReplayResult>;
  /** Discard dead letters via the real bus. */
  discardSignals: (options: SignalDiscardOptions) => Promise<{ readonly discarded: number }>;
  /**
   * Live store runtime. Bound after boot from Manifest (memory default)
   * or host injection.
   */
  storeRuntime: StoreRuntime | null;
  /** Project operator-plane store rows. */
  listStores: () => Promise<{
    readonly stores: readonly ConsoleStoreRow[];
    readonly tenancyDeclared: boolean;
    readonly tenants: readonly string[];
  }>;
  /** Browse a store facet. */
  queryStore: (input: StoreQueryInput) => Promise<StoreQueryResult>;
  /** Read one files object (preview / download). */
  getStoreFile: (input: StoreFileGetInput) => Promise<StoreFileObject>;
  /** Direct edit (not a flow execution). */
  editStore: (
    input: StoreEditInput,
    options?: { readonly dryRun?: boolean },
  ) => Promise<StoreEditResult>;
  /** Delete rows/keys. */
  deleteStore: (input: StoreDeleteInput) => Promise<{ readonly deleted: number }>;
  /** Purge cache keys for a resource. */
  purgeStoreCache: (resource: ResourceRef) => Promise<{ readonly keys: readonly string[] }>;
  /** Raw SQL console. */
  runStoreSql: (
    ref: ResourceRef,
    sqlText: string,
    options: {
      readonly allowWrite: boolean;
      readonly revealPii?: boolean;
      readonly tenant?: string;
      readonly asGate?: string;
    },
  ) => Promise<{
    readonly rows: readonly Record<string, unknown>[];
    readonly masked: boolean;
    readonly routedRole: "primary" | "replica";
    readonly asGate: string | null;
    readonly gateApplied: boolean;
  }>;
  /** Engine-native pg_stat_statements + KPIs. */
  queryStoreSqlStats: (ref: ResourceRef) => Promise<import("./store-stats.ts").StoreSqlStatsResult>;
  /** Live lock blocking (query text collapsed unless reveal). */
  queryStoreSqlLocks: (
    ref: ResourceRef,
    options?: { readonly revealPii?: boolean },
  ) => Promise<import("./store-stats.ts").StoreSqlLocksResult>;
  /** `index_advisor(query)` on a dedicated handle. */
  adviseStoreSqlIndex: (
    ref: ResourceRef,
    query: string,
  ) => Promise<import("./store-stats.ts").StoreSqlAdviseResult>;
  /** Redis-wire KV INFO / COMMANDSTATS / SLOWLOG (args collapsed unless reveal). */
  queryStoreKvStats: (
    ref: ResourceRef,
    options?: { readonly revealPii?: boolean },
  ) => Promise<import("./store-kv-stats.ts").StoreKvStatsResult>;
  /**
   * Live Clock runtime. Bound after boot from Manifest clocks
   * or host injection (A — reuse reconciliation / lease / DST).
   */
  clockRuntime: ClockRuntime | null;
  /** Project Clock panel (timeline + waiting-on + cron health). */
  listClocks: () => Promise<ConsoleClockList>;
  /** Run a cron now (lease-gated). */
  runCronNow: (name: string) => Promise<{ readonly ran: boolean }>;
  /** Pause a cron. */
  pauseCron: (name: string) => Promise<{ readonly name: string; readonly status: string }>;
  /** Edit overridable schedule. */
  editSchedule: (input: EditScheduleInput) => Promise<{
    readonly name: string;
    readonly effectiveCron?: string;
    readonly effectiveEvery?: string;
  }>;
  /** Wake a sleeping durable run early and resume. */
  wakeEarly: (runId: string) => Promise<{
    readonly runId: string;
    readonly wakeAt: number;
    readonly resumed: boolean;
  }>;
  /**
   * Live vault runtime. Bound after boot from Manifest (standard chain)
   * or host injection.
   */
  vaultRuntime: VaultRuntime | null;
  /** Per-layer seed bag for Manifest vault boot (seeded Console). */
  vaultLayerSeed: VaultLayerSeed | null;
  /** Durable journal for rotation blast radius + Clock waiting-on. */
  journalStore: JournalStore | null;
  /** Host fleet registry (read-only). Null until bound or confirmed absent. */
  instanceStore: InstanceStore | null;
  /** Host `oke_crons` for fleet lease join (not Console's memory clock). */
  fleetCronStore: CronStore | null;
  /** Project live instances + Clock / Journal lease snapshot. */
  listInstances: () => Promise<InstancesList>;
  /** Current environment label for fingerprint columns. */
  vaultEnv: string;
  /** Project operator-plane vault rows (fingerprints only for secrets). */
  listVault: () => Promise<{
    readonly secrets: readonly ConsoleVaultRow[];
    readonly env: string;
    readonly backend: ConsoleVaultBackend | null;
  }>;
  /** Set a vault value (write-only). */
  setVault: (
    input: VaultWriteInput,
  ) => Promise<{ readonly name: string; readonly fingerprint: string | null }>;
  /** Declare a contract from Console and write its value. */
  createVault: (
    input: VaultCreateInput,
  ) => Promise<{ readonly name: string; readonly fingerprint: string | null }>;
  /** Rotate a vault value (write-only; distinct confirm phrase). */
  rotateVault: (
    input: VaultWriteInput,
  ) => Promise<{ readonly name: string; readonly fingerprint: string | null }>;
  /** Verify the built-in audit chain (sealed). */
  verifyVaultAudit: () => Promise<ConsoleVaultAuditVerifyResult>;
  /**
   * One batch of master-key rotation. Process-global handle — any operator
   * in this process may continue. Overlapping batches fail busy.
   */
  rotateMaster: () => Promise<ConsoleVaultRotateMasterResult>;
  /** In-flight rotate-master adapter (tests / process lifetime). */
  vaultRotateHandle: ConsoleVaultRotateHandle | null;
  /** True while the first rotate-master call is opening the adapter. */
  vaultRotateStarting: boolean;
  /** User-plane identities available for invoke-as. */
  readonly identities: ConsoleIdentity[];
  /** Whether this process is treated as production (typed confirm). */
  readonly production: boolean;
  /**
   * Live AI runtime — journal, denial ledger, agent trails (console §9.10).
   * Bound after host boot; null until wired.
   */
  aiRuntime: AiRuntime | null;
  /** Eval suite history for score distributions. */
  evalResults: EvalSuiteResult[];
  /** Project AI panel from runtime + Manifest + runs. */
  listAi: () => Promise<ConsoleAiProjection>;
  /**
   * Project Manifest Diff — `diffManifest` + Runs traffic + weekly bill
   * (console §9.12).
   */
  listDiff: () => Promise<ConsoleDiffProjection>;
  /**
   * Project Plugins panel — origin × state, supply-chain, capability diff
   * (console §9.15). Read-only; never installs.
   */
  listPlugins: () => Promise<ConsolePluginsList>;
  /** Loaded oke.config for CORE tenancy/privacy state derivation. */
  okeConfig: OkeConfig | null;
  /** Live plugin registry from host boot (optional). */
  pluginRegistry: PluginRegistry | null;
  /**
   * Live Channel runtime + shared console inbox (console §9.9).
   * Bound after boot from Manifest or host injection.
   */
  channelRuntime: ChannelRuntime | null;
  /** Dev console-driver inbox (all media land here). */
  channelInbox: ChannelInbox | null;
  /** Optional i18n body catalog for previews. */
  channelCatalog: TemplateCatalog;
  /** Project Channels panel (inbox / deliverability). */
  listChannels: () => Promise<ConsoleChannelsList>;
  /** Locale-resolved template preview. */
  previewChannel: (input: {
    readonly template: string;
    readonly locale?: string;
    readonly profileLocale?: string;
    readonly acceptLanguage?: string;
    readonly data?: Readonly<Record<string, unknown>>;
  }) => Promise<ConsoleChannelPreview>;
  /** SPF/DKIM/DMARC for a From domain. */
  verifyChannelAuth: (fromOrDomain: string) => Promise<EmailAuthResult>;
  /** Audited recipient reveal. */
  revealChannel: (id: string) => Promise<{
    readonly id: string;
    readonly to: string;
  } | null>;
  /** Real send-test through the Channel runtime. */
  sendChannelTest: (input: {
    readonly template: string;
    readonly to: string;
    readonly locale?: string;
    readonly data?: Readonly<Record<string, unknown>>;
  }) => Promise<{
    readonly ok: boolean;
    readonly messageId: string;
    readonly status: string;
    readonly chain: string;
  }>;
  /** Whether first operator exists (wizard permanently closed). */
  get setupClosed(): boolean;
  /**
   * Persist an operator after claim/create (`oke_console` schema).
   * No-op when persistence is disabled (tests / memory-only).
   */
  persistOperator: (operatorId: string) => void | Promise<void>;
  /**
   * Persist sessions after issue / revoke (`oke_console` schema).
   * No-op when persistence is disabled (tests / memory-only).
   */
  persistSessions: () => void | Promise<void>;
  /**
   * Per-email login attempt timestamps for credential-check rate limiting
   * (console §10.4 — same 5/60s strategy as setup-claim).
   */
  readonly loginAttempts: LoginAttemptBag;
}

/** Live channel message kinds. */
export type ConsoleLiveMessage =
  | { readonly type: "manifest"; readonly manifest: Manifest }
  | {
      readonly type: "manifest.diff";
      readonly before: Manifest;
      readonly after: Manifest;
    }
  | { readonly type: "ping"; readonly at: number }
  | { readonly type: "run"; readonly run: ConsoleLiveRun }
  | { readonly type: "runs.batch"; readonly runs: readonly ConsoleLiveRun[] };

/**
 * Projected run pushed over the live channel.
 *
 * Kept structurally identical to the `GET /console/runs` row projection
 * (`projectRun` in `flows.ts`) so the client can treat HTTP and WS rows
 * interchangeably.
 */
export interface ConsoleLiveRun {
  readonly id: string;
  readonly parentId: string | null;
  readonly flow: string;
  readonly unit: string | null;
  readonly trigger: string;
  readonly plane: string;
  readonly tenant: string | null;
  readonly principal: string | null;
  readonly gates: readonly string[];
  readonly cache: "hit" | "miss" | "none";
  readonly replica: "primary" | "replica" | null;
  readonly replicaLagMs: number | null;
  readonly cost: number | null;
  readonly promptVersion: number | null;
  readonly buildVersion: string | null;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly error: string | null;
  /** Optional human message paired with {@link error}. */
  readonly errorMessage: string | null;
  readonly sampled: "full" | "error" | "sample" | "boost";
  readonly effects: readonly ConsoleLiveRunEffect[];
  readonly logs: readonly ConsoleLiveRunLog[];
  readonly dimensions: Record<string, string | number | boolean | null>;
  /** Validated flow input snapshot — null when the run has no stored input. */
  readonly input: unknown;
  /** Flow return value snapshot — null when the run has no stored output. */
  readonly output: unknown;
}

/** Effect entry on a live run row. */
export interface ConsoleLiveRunEffect {
  readonly kind: "read" | "write" | "emit" | "send" | "ask" | "secret" | "call";
  readonly resource: string;
  readonly timestamp: number;
  readonly duration: number;
  readonly reversibility:
    | "none"
    | "reversible"
    | "deferred"
    | "irreversible"
    | "capability"
    | "portal";
}

/** Log line on a live run row. */
export interface ConsoleLiveRunLog {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly message: string;
  readonly data?: Record<string, unknown>;
  readonly at: number;
}

/** Options for {@link createConsoleState}. */
export interface CreateConsoleStateOptions {
  readonly secret?: string;
  readonly now?: () => number;
  readonly cwd?: string;
  readonly manifest?: Manifest | null;
  /** Skip stdout claim print (`oke dev` paints the board; tests). Artifact still written. */
  readonly silentClaim?: boolean;
  /** Seed identities for the invoke-as picker. */
  readonly identities?: readonly ConsoleIdentity[];
  /** Production flag — irreversible invokes require typed confirm. */
  readonly production?: boolean;
  /** Access-token TTL override (ms) — residual revoke delay note. */
  readonly accessTtlMs?: number;
  /** Injected vault runtime (tests / host). */
  readonly vaultRuntime?: VaultRuntime | null;
  /** Per-layer seed bag for Manifest vault boot (seeded Console). */
  readonly vaultLayerSeed?: VaultLayerSeed | null;
  /** Injected journal store for blast-radius / waiting-on queries. */
  readonly journalStore?: JournalStore | null;
  /** Injected host fleet registry (tests / host). */
  readonly instanceStore?: InstanceStore | null;
  /** Injected host cron store for fleet lease join (tests / host). */
  readonly fleetCronStore?: CronStore | null;
  /** Environment label for vault fingerprints. */
  readonly vaultEnv?: string;
  /** Env map for builtin adapter open / probe (tests). */
  readonly vaultProcessEnv?: Readonly<Record<string, string | undefined>>;
  /** DEKs per rotate-master batch (tests). */
  readonly vaultKekRewrapBatchSize?: number;
  /** Test hook: awaited after claiming the batch slot, before adapter work. */
  readonly rotateBatchHold?: () => Promise<void>;
  /** Injected GateRuntime (tests / host). */
  readonly gateRuntime?: GateRuntime | null;
  /** Injected ClockRuntime (tests / host). */
  readonly clockRuntime?: ClockRuntime | null;
  /** Previous Manifest for widenings (tests). */
  readonly previousManifest?: Manifest | null;
  /** Injected ChannelRuntime (tests / host). */
  readonly channelRuntime?: ChannelRuntime | null;
  /** Injected console inbox (tests / host). */
  readonly channelInbox?: ChannelInbox | null;
  /** Template body catalog for previews. */
  readonly channelCatalog?: TemplateCatalog;
  /** Loaded oke.config (tenancy / privacy state derivation). */
  readonly okeConfig?: OkeConfig | null;
  /** Host plugin registry for scopes / capabilities. */
  readonly pluginRegistry?: PluginRegistry | null;
  /** Pre-hydrated operator store (from `oke_console` / PGlite fallback). */
  readonly operators?: OperatorStore;
  /** Pre-hydrated session store (from `oke_console` / PGlite fallback). */
  readonly sessions?: SessionStore;
  /** Persist hook after claim/create. */
  readonly persistOperator?: (operatorId: string) => void | Promise<void>;
  /** Persist hook after session issue / revoke. */
  readonly persistSessions?: () => void | Promise<void>;
  /**
   * Shared secret for host → Console runs ingest (`oke dev` bridge).
   * When omitted, ingest is disabled (404).
   */
  readonly runsIngestSecret?: string | null;
}

/**
 * Create Console state and mint a claim code for this boot.
 *
 * @param options - Secret, clock, cwd
 */
export function createConsoleState(options: CreateConsoleStateOptions = {}): ConsoleState {
  const secret =
    options.secret ?? process.env.OKE_CONSOLE_SECRET ?? `oke-console-dev-${crypto.randomUUID()}`;
  const now = options.now ?? (() => Date.now());
  const operators = options.operators ?? createOperatorStore();
  const claim = mintClaimCode(now);
  const sessions = options.sessions ?? createSessionStore();
  const liveSubscribers = new Set<(msg: ConsoleLiveMessage) => void>();
  const persistOperator = options.persistOperator ?? ((_operatorId: string) => {});
  const persistSessions = options.persistSessions ?? (() => {});

  const signalConfig = createMemorySignalConfigStore();
  const gateAuth = createDefaultGateAuthStores();
  const invites = createOperatorInviteStore();
  const constructed = new Set<ConsolePanelId>();
  let accessSeeded = false;

  const markPanel = async <T>(id: ConsolePanelId): Promise<T> => {
    constructed.add(id);
    return loadConsolePanel<T>(id);
  };

  // The Vault panel polls; probing the built-in backend opens a SQL
  // connection, so hold the answer for a beat rather than per refresh.
  let backendMemo: { readonly at: number; readonly value: ConsoleVaultBackend | null } | null =
    null;
  const vaultBackend = async (
    vault: typeof import("./vault.ts"),
  ): Promise<ConsoleVaultBackend | null> => {
    const at = state.now();
    if (backendMemo && at - backendMemo.at < VAULT_BACKEND_TTL_MS) return backendMemo.value;
    const value = await vault.probeVaultBackend({
      config: state.okeConfig,
      env: state.production ? "prod" : "dev",
      ...(options.vaultProcessEnv !== undefined ? { processEnv: options.vaultProcessEnv } : {}),
    });
    backendMemo = { at, value };
    return value;
  };

  const state: ConsoleState = {
    operators,
    sessions,
    claim,
    loginAttempts: createLoginAttemptBag(),
    secret,
    now,
    cwd: options.cwd ?? process.cwd(),
    manifest: options.manifest ?? null,
    previousManifest: options.previousManifest ?? null,
    liveSubscribers,
    get constructedPanels() {
      return constructed;
    },
    roles: gateAuth.roles,
    apiKeys: gateAuth.apiKeys,
    invites,
    accessTtlMs: options.accessTtlMs ?? ACCESS_TTL_MS,
    roleMembers: gateAuth.roleMembers,
    listAccess: async (actorScopes) => {
      const access = await markPanel<typeof import("./access.ts")>("access");
      if (!accessSeeded) {
        seedAccessDemoData(state.apiKeys, state.invites, state.now);
        accessSeeded = true;
      }
      return access.projectAccessPanel({
        manifest: state.manifest,
        roles: state.roles,
        apiKeys: state.apiKeys,
        operators: state.operators,
        invites: state.invites,
        identities: state.identities,
        roleMembers: state.roleMembers,
        actorScopes,
        accessTtlMs: state.accessTtlMs,
        now: state.now,
      });
    },
    accessEffective: async (input) => {
      const access = await markPanel<typeof import("./access.ts")>("access");
      return access.effectivePermissions({
        ...input,
        roles: state.roles,
        apiKeys: state.apiKeys,
        operators: state.operators,
        identities: state.identities,
        roleMembers: state.roleMembers,
      });
    },
    accessKeyBlast: async (keyId) => {
      const access = await markPanel<typeof import("./access.ts")>("access");
      const runs = await state.listRuns();
      return access.keyBlastRadius({
        keyId,
        apiKeys: state.apiKeys,
        runs,
        accessTtlMs: state.accessTtlMs,
      });
    },
    accessCreateKey: async (input) => {
      const access = await markPanel<typeof import("./access.ts")>("access");
      return access.accessCreateKey(state.apiKeys, {
        ...input,
        catalog: accessCatalog(state),
        now: state.now,
      });
    },
    accessRevokeKey: async (keyId) => {
      const access = await markPanel<typeof import("./access.ts")>("access");
      return access.accessRevokeKey({
        apiKeys: state.apiKeys,
        sessions: state.sessions,
        keyId,
        now: state.now,
      });
    },
    accessRotateKey: async (keyId) => {
      const access = await markPanel<typeof import("./access.ts")>("access");
      return access.accessRotateKey(state.apiKeys, keyId);
    },
    accessSetRoleGrants: async (input) => {
      const access = await markPanel<typeof import("./access.ts")>("access");
      access.accessSetRoleGrants({
        roles: state.roles,
        roleId: input.roleId,
        scopes: input.scopes,
        actorScopes: input.actorScopes,
        catalog: accessCatalog(state),
      });
    },
    accessCreateInvite: async (input) => {
      const access = await markPanel<typeof import("./access.ts")>("access");
      const row = access.accessCreateInvite(state.invites, {
        ...input,
        now: state.now,
      });
      return { id: row.id, email: row.email, expiresAt: row.expiresAt };
    },
    gateRuntime: options.gateRuntime ?? null,
    listGates: async () => {
      const { ensureConsolePanelRuntimes } = await import("./app.ts");
      await ensureConsolePanelRuntimes(state, "gates");
      const gates = await markPanel<typeof import("./gates.ts")>("gates");
      const operatorRoles = new Map<string, readonly string[]>();
      const ops = new Map<string, { name: string; email: string }>();
      for (const [id, roleIds] of operators.roles) {
        operatorRoles.set(id, roleIds);
      }
      for (const op of operators.operators.values()) {
        ops.set(op.id, { name: op.name, email: op.email });
      }
      return gates.projectGatesPanel({
        manifest: state.manifest,
        roles: state.roles,
        apiKeys: state.apiKeys,
        identities: state.identities,
        operatorRoles,
        operators: ops,
        roleMembers: state.roleMembers,
        previousManifest: state.previousManifest,
      });
    },
    simulateGates: async (input) => {
      const gates = await markPanel<typeof import("./gates.ts")>("gates");
      return gates.simulateGates({
        ...input,
        manifest: state.manifest,
        gateRuntime: state.gateRuntime,
        roles: state.roles,
        apiKeys: state.apiKeys,
        identities: state.identities,
        now: state.now,
      });
    },
    powersForPrincipal: async (input) => {
      const gates = await markPanel<typeof import("./gates.ts")>("gates");
      return gates.powersForPrincipal({
        ...input,
        manifest: state.manifest,
        gateRuntime: state.gateRuntime,
        roles: state.roles,
        apiKeys: state.apiKeys,
        identities: state.identities,
        now: state.now,
      });
    },
    listRuns: async () => [],
    queryPersistedRuns: async () => {
      throw new Error("queryPersistedRuns is unbound until Console boot");
    },
    runsIngestSecret: options.runsIngestSecret ?? null,
    replayTrace: null,
    invokeUserFlow: null,
    signalConfig,
    signalBus: null,
    listSignals: async () => {
      const { ensureConsolePanelRuntimes } = await import("./app.ts");
      await ensureConsolePanelRuntimes(state, "signals");
      const signals = await markPanel<typeof import("./signals.ts")>("signals");
      const runs = await state.listRuns();
      return signals.projectSignalsList({
        manifest: state.manifest,
        config: state.signalConfig,
        bus: state.signalBus,
        runs: runs.map((r) => ({
          id: r.id,
          flow: r.flow,
          startedAt: r.startedAt,
          effects: r.effects.map((e) => ({
            kind: e.kind,
            resource: e.resource,
          })),
        })),
      });
    },
    replaySignals: async (opts) => {
      const signals = await markPanel<typeof import("./signals.ts")>("signals");
      if (!state.signalBus) {
        return {
          attempted: 0,
          succeeded: 0,
          failed: 0,
          dryRun: opts.dryRun,
          results: [],
          wouldHaveFired: [],
        };
      }
      return signals.replayViaBus(state.signalBus, opts);
    },
    discardSignals: async (opts) => {
      const signals = await markPanel<typeof import("./signals.ts")>("signals");
      if (!state.signalBus) return { discarded: 0 };
      return signals.discardViaBus(state.signalBus, opts);
    },
    storeRuntime: null,
    listStores: async () => {
      const { ensureConsolePanelRuntimes } = await import("./app.ts");
      await ensureConsolePanelRuntimes(state, "store");
      const store = await markPanel<typeof import("./store.ts")>("store");
      const runs = await state.listRuns();
      return store.projectStoresList({
        manifest: state.manifest,
        runtime: state.storeRuntime,
        cwd: state.cwd,
        runs: runs.map((r) => ({
          flow: r.flow,
          replicaLagMs: r.replicaLagMs,
          tenant: r.tenant,
          effects: r.effects,
        })),
      });
    },
    queryStore: async (input) => {
      if (isConsoleAuthStoreRef(input.ref)) {
        requireConsoleAuthStore();
        return queryConsoleAuthStore(
          {
            operators: state.operators,
            sessions: state.sessions,
            roles: state.roles,
            apiKeys: state.apiKeys,
            invites: state.invites,
            identities: state.identities,
            roleMembers: state.roleMembers,
          },
          input,
        );
      }
      const store = await markPanel<typeof import("./store.ts")>("store");
      if (!state.storeRuntime) {
        return { facet: input.ref.split(":")[0] as "sql", rows: [], masked: true };
      }
      return store.queryStore(state.storeRuntime, state.manifest, input);
    },
    getStoreFile: async (input) => {
      const store = await markPanel<typeof import("./store.ts")>("store");
      if (!state.storeRuntime) {
        throw new Error("Store runtime not bound");
      }
      return store.getStoreFile(state.storeRuntime, input);
    },
    editStore: async (input, opts) => {
      rejectConsoleAuthMutation(input.ref);
      const store = await markPanel<typeof import("./store.ts")>("store");
      if (!state.storeRuntime) {
        throw new Error("Store runtime not bound");
      }
      return store.editStore(state.storeRuntime, state.manifest, input, {
        production: state.production,
        dryRun: opts?.dryRun,
      });
    },
    deleteStore: async (input) => {
      rejectConsoleAuthMutation(input.ref);
      const store = await markPanel<typeof import("./store.ts")>("store");
      if (!state.storeRuntime) return { deleted: 0 };
      return store.deleteStore(state.storeRuntime, input, state.manifest);
    },
    purgeStoreCache: async (resource) => {
      const store = await markPanel<typeof import("./store.ts")>("store");
      if (!state.storeRuntime) return { keys: [] };
      return store.purgeStoreCache(state.storeRuntime, resource);
    },
    runStoreSql: async (ref, sqlText, options) => {
      rejectConsoleAuthMutation(ref);
      const store = await markPanel<typeof import("./store.ts")>("store");
      if (!state.storeRuntime) {
        throw new Error("Store runtime not bound");
      }
      return store.runStoreSql(state.storeRuntime, ref, sqlText, options);
    },
    queryStoreSqlStats: async (ref) => {
      const stats = await import("./store-stats.ts");
      await markPanel<typeof import("./store.ts")>("store");
      if (!state.storeRuntime) {
        throw new stats.StoreSqlStatsError(
          stats.PG_STAT_STATEMENTS_UNSUPPORTED,
          "Store runtime not bound",
        );
      }
      return stats.queryStoreSqlStats(state.storeRuntime, ref);
    },
    queryStoreSqlLocks: async (ref, options) => {
      const stats = await import("./store-stats.ts");
      await markPanel<typeof import("./store.ts")>("store");
      if (!state.storeRuntime) {
        throw new stats.StoreSqlStatsError(
          stats.PG_STAT_STATEMENTS_UNSUPPORTED,
          "Store runtime not bound",
        );
      }
      return stats.queryStoreSqlLocks(state.storeRuntime, ref, options);
    },
    adviseStoreSqlIndex: async (ref, query) => {
      const stats = await import("./store-stats.ts");
      await markPanel<typeof import("./store.ts")>("store");
      if (!state.storeRuntime) {
        throw new stats.StoreSqlStatsError(
          stats.PG_STAT_STATEMENTS_UNSUPPORTED,
          "Store runtime not bound",
        );
      }
      return stats.adviseStoreSqlIndex(state.storeRuntime, ref, query);
    },
    queryStoreKvStats: async (ref, options) => {
      const kvStats = await import("./store-kv-stats.ts");
      await markPanel<typeof import("./store.ts")>("store");
      if (!state.storeRuntime) {
        throw new kvStats.StoreKvStatsError(
          kvStats.KV_STATS_UNSUPPORTED,
          "Store runtime not bound",
        );
      }
      return kvStats.queryStoreKvStats(state.storeRuntime, ref, options);
    },
    clockRuntime: options.clockRuntime ?? null,
    listClocks: async () => {
      const { ensureConsolePanelRuntimes } = await import("./app.ts");
      await ensureConsolePanelRuntimes(state, "clock");
      const clock = await markPanel<typeof import("./clock.ts")>("clock");
      return clock.projectClocksList({
        manifest: state.manifest,
        runtime: state.clockRuntime,
        journal: state.journalStore,
        now: state.now,
      });
    },
    runCronNow: async (name) => {
      const clock = await markPanel<typeof import("./clock.ts")>("clock");
      if (!state.clockRuntime) {
        throw new Error("Clock runtime not bound");
      }
      return clock.runCronNow(state.clockRuntime, name);
    },
    pauseCron: async (name) => {
      const clock = await markPanel<typeof import("./clock.ts")>("clock");
      if (!state.clockRuntime) {
        throw new Error("Clock runtime not bound");
      }
      const row = await clock.pauseCronNow(state.clockRuntime, name);
      return { name: row.name, status: row.status };
    },
    editSchedule: async (input) => {
      const clock = await markPanel<typeof import("./clock.ts")>("clock");
      if (!state.clockRuntime) {
        throw new Error("Clock runtime not bound");
      }
      const row = await clock.editCronSchedule(state.clockRuntime, input);
      return {
        name: row.name,
        effectiveCron: row.effectiveCron,
        effectiveEvery: row.effectiveEvery,
      };
    },
    wakeEarly: async (runId) => {
      const clock = await markPanel<typeof import("./clock.ts")>("clock");
      if (!state.journalStore) {
        throw new Error("Journal store not bound");
      }
      const result = await clock.wakeEarlyNow(state.journalStore, runId, {
        now: state.now,
      });
      return {
        runId: result.runId,
        wakeAt: result.wakeAt,
        resumed: result.resumed,
      };
    },
    vaultRuntime: options.vaultRuntime ?? null,
    vaultLayerSeed: options.vaultLayerSeed ?? null,
    journalStore: options.journalStore ?? null,
    instanceStore: options.instanceStore ?? null,
    fleetCronStore: options.fleetCronStore ?? null,
    listInstances: async () => {
      const instances = await markPanel<typeof import("./instances.ts")>("instances");
      return instances.listConsoleInstances(state);
    },
    vaultEnv: options.vaultEnv ?? "dev",
    listVault: async () => {
      const { ensureConsolePanelRuntimes } = await import("./app.ts");
      await ensureConsolePanelRuntimes(state, "vault");
      const vault = await markPanel<typeof import("./vault.ts")>("vault");
      return vault.projectVaultList({
        manifest: state.manifest,
        runtime: state.vaultRuntime,
        journal: state.journalStore,
        env: state.vaultEnv,
        now: state.now,
        cwd: state.cwd,
        backend: await vaultBackend(vault),
      });
    },
    setVault: async (input) => {
      const { ensureConsolePanelRuntimes } = await import("./app.ts");
      await ensureConsolePanelRuntimes(state, "vault");
      const vault = await markPanel<typeof import("./vault.ts")>("vault");
      if (!state.vaultRuntime) {
        state.vaultRuntime = await vault.createManifestVaultRuntime(
          state.manifest ?? { oke: "1.0", app: "app" },
          {
            cwd: state.cwd,
            env: state.production ? "prod" : "dev",
            allowDevFallbacks: !state.production,
            now: state.now,
            driverId: vault.resolveVaultDriverId(
              state.okeConfig,
              state.production ? "prod" : "dev",
            ),
          },
        );
      }
      if (!state.vaultRuntime) {
        throw new Error("Vault runtime not bound");
      }
      return vault.setVaultValue(state.vaultRuntime, input);
    },
    createVault: async (input) => {
      const { ensureConsolePanelRuntimes } = await import("./app.ts");
      await ensureConsolePanelRuntimes(state, "vault");
      const vault = await markPanel<typeof import("./vault.ts")>("vault");
      if (!state.vaultRuntime) {
        state.vaultRuntime = await vault.createManifestVaultRuntime(
          state.manifest ?? { oke: "1.0", app: "app" },
          {
            cwd: state.cwd,
            env: state.production ? "prod" : "dev",
            allowDevFallbacks: !state.production,
            now: state.now,
            driverId: vault.resolveVaultDriverId(
              state.okeConfig,
              state.production ? "prod" : "dev",
            ),
          },
        );
      }
      if (!state.vaultRuntime) {
        throw new Error("Vault runtime not bound");
      }
      return vault.createVaultContract(state.vaultRuntime, state.cwd, state.manifest, input);
    },
    rotateVault: async (input) => {
      const { ensureConsolePanelRuntimes } = await import("./app.ts");
      await ensureConsolePanelRuntimes(state, "vault");
      const vault = await markPanel<typeof import("./vault.ts")>("vault");
      if (!state.vaultRuntime) {
        state.vaultRuntime = await vault.createManifestVaultRuntime(
          state.manifest ?? { oke: "1.0", app: "app" },
          {
            cwd: state.cwd,
            env: state.production ? "prod" : "dev",
            allowDevFallbacks: !state.production,
            now: state.now,
            driverId: vault.resolveVaultDriverId(
              state.okeConfig,
              state.production ? "prod" : "dev",
            ),
          },
        );
      }
      if (!state.vaultRuntime) {
        throw new Error("Vault runtime not bound");
      }
      return vault.rotateVaultValue(state.vaultRuntime, input);
    },
    vaultRotateHandle: null,
    vaultRotateStarting: false,
    verifyVaultAudit: async () => {
      const vault = await markPanel<typeof import("./vault.ts")>("vault");
      return vault.verifyConsoleVaultAudit({
        config: state.okeConfig,
        env: state.production ? "prod" : "dev",
        ...(options.vaultProcessEnv !== undefined ? { processEnv: options.vaultProcessEnv } : {}),
      });
    },
    rotateMaster: async () => {
      const vault = await markPanel<typeof import("./vault.ts")>("vault");
      return runConsoleRotateMaster(state, vault, options);
    },
    identities: [...(options.identities ?? defaultDevIdentities(options.manifest))],
    production: options.production ?? process.env.NODE_ENV === "production",
    aiRuntime: null,
    evalResults: [],
    listAi: async () => {
      const { ensureConsolePanelRuntimes } = await import("./app.ts");
      await ensureConsolePanelRuntimes(state, "ai");
      const ai = await markPanel<typeof import("./ai.ts")>("ai");
      const runs = await state.listRuns();
      return ai.projectAiPanel({
        manifest: state.manifest,
        aiRuntime: state.aiRuntime,
        runs,
        evalResults: state.evalResults,
      });
    },
    listDiff: async () => {
      const diff = await markPanel<typeof import("./diff.ts")>("diff");
      const runs = await state.listRuns();
      return diff.projectManifestDiff({
        before: state.previousManifest,
        after: state.manifest,
        runs,
        now: state.now(),
      });
    },
    okeConfig: options.okeConfig ?? null,
    pluginRegistry: options.pluginRegistry ?? null,
    listPlugins: async () => {
      const plugins = await markPanel<typeof import("./plugins.ts")>("plugins");
      return plugins.projectPluginsList({
        manifest: state.manifest,
        config: state.okeConfig,
        registry: state.pluginRegistry,
        cwd: state.cwd,
        now: state.now,
        fetchNpm: false,
      });
    },
    channelRuntime: options.channelRuntime ?? null,
    channelInbox: options.channelInbox ?? null,
    channelCatalog: options.channelCatalog ?? {},
    listChannels: async () => {
      const { ensureConsolePanelRuntimes } = await import("./app.ts");
      await ensureConsolePanelRuntimes(state, "channels");
      const channels = await markPanel<typeof import("./channels.ts")>("channels");
      return channels.projectChannelsList({
        manifest: state.manifest,
        runtime: state.channelRuntime,
        inbox: state.channelInbox,
        production: state.production,
        now: state.now,
        catalog: state.channelCatalog,
      });
    },
    previewChannel: async (input) => {
      const channels = await markPanel<typeof import("./channels.ts")>("channels");
      return channels.previewChannelTemplate({
        runtime: state.channelRuntime,
        manifest: state.manifest,
        catalog: state.channelCatalog,
        template: input.template,
        locale: input.locale,
        profileLocale: input.profileLocale,
        acceptLanguage: input.acceptLanguage,
        data: input.data,
      });
    },
    verifyChannelAuth: async (fromOrDomain) => {
      const channels = await markPanel<typeof import("./channels.ts")>("channels");
      return channels.verifyChannelAuth(fromOrDomain);
    },
    revealChannel: async (id) => {
      const channels = await markPanel<typeof import("./channels.ts")>("channels");
      return channels.revealChannelRecipient({
        runtime: state.channelRuntime,
        inbox: state.channelInbox,
        id,
      });
    },
    sendChannelTest: async (input) => {
      const channels = await markPanel<typeof import("./channels.ts")>("channels");
      if (!state.channelRuntime) {
        throw new Error("Channel runtime not bound");
      }
      return channels.sendChannelTest(state.channelRuntime, input);
    },
    get setupClosed() {
      return operators.operators.size > 0;
    },
    persistOperator,
    persistSessions,
  };

  return state;
}

/**
 * Bind a live {@link AiRuntime} and wire Manifest effects into agent trails.
 *
 * @param state - Console state
 * @param runtime - AI runtime
 */
export function bindAiRuntime(state: ConsoleState, runtime: AiRuntime): void {
  state.aiRuntime = runtime;
}

/**
 * Resolve tool-flow effects from the current Manifest (lazy AI panel module).
 *
 * @param state - Console state
 * @param flowName - Tool flow
 */
export async function consoleEffectsForFlow(
  state: ConsoleState,
  flowName: string,
): Promise<readonly AgentToolEffect[]> {
  const ai = await loadConsolePanel<typeof import("./ai.ts")>("ai");
  return ai.effectsForFlowFromManifest(state.manifest, flowName);
}

/**
 * Publish a live message to all WebSocket / channel subscribers.
 *
 * @param state - Console state
 * @param message - Payload
 */
export function publishLive(state: ConsoleState, message: ConsoleLiveMessage): void {
  for (const sub of state.liveSubscribers) {
    try {
      sub(message);
    } catch {
      // Drop broken subscribers.
    }
  }
}

/**
 * Replace the Manifest snapshot and notify live subscribers.
 *
 * @param state - Console state
 * @param manifest - New Manifest
 */
export function setManifest(state: ConsoleState, manifest: Manifest): void {
  const before = state.manifest;
  if (before) state.previousManifest = before;
  state.manifest = manifest;
  publishLive(state, { type: "manifest", manifest });
  if (before) {
    publishLive(state, { type: "manifest.diff", before, after: manifest });
  }
}

/**
 * One rotate-master batch on the process-global handle.
 *
 * @param state - Console state
 * @param vault - Vault panel module
 * @param options - Open / hold knobs
 */
async function runConsoleRotateMaster(
  state: ConsoleState,
  vault: typeof import("./vault.ts"),
  options: CreateConsoleStateOptions,
): Promise<ConsoleVaultRotateMasterResult> {
  const openOpts = {
    config: state.okeConfig,
    env: state.production ? ("prod" as const) : ("dev" as const),
    unseal: true as const,
    ...(options.vaultProcessEnv !== undefined ? { processEnv: options.vaultProcessEnv } : {}),
    ...(options.vaultKekRewrapBatchSize === undefined
      ? {}
      : { kekRewrapBatchSize: options.vaultKekRewrapBatchSize }),
  };

  if (state.vaultRotateHandle?.inFlight || state.vaultRotateStarting) {
    throw new ConsoleVaultRotateBusyError("vault: a master rotation is already in progress");
  }

  if (state.vaultRotateHandle) {
    state.vaultRotateHandle.inFlight = true;
    try {
      await options.rotateBatchHold?.();
      const progress = await state.vaultRotateHandle.adapter.continueRotateMaster();
      if (progress.remaining === 0) {
        await state.vaultRotateHandle.close();
        state.vaultRotateHandle = null;
      }
      return {
        kekVersion: progress.kekVersion,
        remaining: progress.remaining,
        masterKey: null,
      };
    } catch (error) {
      return vault.mapConsoleVaultError(error);
    } finally {
      if (state.vaultRotateHandle) state.vaultRotateHandle.inFlight = false;
    }
  }

  state.vaultRotateStarting = true;
  let opened: Awaited<ReturnType<typeof vault.openConsoleBuiltinAdapter>>;
  try {
    opened = await vault.openConsoleBuiltinAdapter(openOpts);
  } catch (error) {
    state.vaultRotateStarting = false;
    return vault.mapConsoleVaultError(error);
  }

  try {
    const status = await opened.adapter.status();
    if (status.rewrapTargetKekVersion !== undefined) {
      await opened.close();
      throw new ConsoleVaultRotateBusyError(
        "vault: resume rotate-master with the new master key (`oke vault rotate-master --new-key`)",
      );
    }

    state.vaultRotateHandle = {
      adapter: opened.adapter,
      close: () => opened.close(),
      inFlight: true,
    };
    await options.rotateBatchHold?.();
    const progress = await opened.adapter.rotateMaster();
    if (progress.remaining === 0) {
      await opened.close();
      state.vaultRotateHandle = null;
    }
    return {
      kekVersion: progress.kekVersion,
      remaining: progress.remaining,
      masterKey: progress.masterKey ?? null,
    };
  } catch (error) {
    await opened.close().catch(() => undefined);
    state.vaultRotateHandle = null;
    return vault.mapConsoleVaultError(error);
  } finally {
    state.vaultRotateStarting = false;
    if (state.vaultRotateHandle) state.vaultRotateHandle.inFlight = false;
  }
}

/**
 * Bind a live {@link GateRuntime} from the host app (preferred over Manifest
 * reconstruction).
 *
 * @param state - Console state
 * @param runtime - Gate runtime
 */
export function bindGateRuntime(state: ConsoleState, runtime: GateRuntime): void {
  state.gateRuntime = runtime;
}

/**
 * Open a GateRuntime from the Manifest when no host runtime is attached.
 *
 * @param state - Console state
 */
export async function bindManifestGateRuntime(state: ConsoleState): Promise<void> {
  if (state.gateRuntime) return;
  if (!state.manifest?.gates && !state.manifest?.flows) return;
  const hasGates =
    Object.keys(state.manifest.gates ?? {}).length > 0 ||
    Object.values(state.manifest.flows ?? {}).some((f) => (f.gates?.length ?? 0) > 0);
  if (!hasGates) return;
  const { runtime } = await createManifestGateRuntime(state.manifest, state.now);
  state.gateRuntime = runtime;
}

/**
 * Default development identities for the invoke-as picker.
 * Demo scopes follow Manifest gate `scopes` when present so Call API
 * matches the seeded app (keel `issue:write`, skyport `booking:create`).
 *
 * @param manifest - Optional Manifest used to derive application scopes
 */
function defaultDevIdentities(manifest?: Manifest | null): ConsoleIdentity[] {
  const scopes = new Set<string>(["member"]);
  for (const gate of Object.values(manifest?.gates ?? {})) {
    for (const scope of gate.scopes ?? []) {
      scopes.add(scope);
    }
  }
  if (scopes.size === 1) scopes.add("booking:create");
  return [
    {
      id: "user_demo",
      email: "demo@example.com",
      name: "Demo User",
      status: "active",
      scopes: [...scopes].sort(),
    },
    {
      id: "user_member",
      email: "member@example.com",
      name: "Member",
      status: "active",
      scopes: ["member"],
    },
  ];
}

function accessCatalog(state: ConsoleState): string[] {
  if (state.manifest) return deriveModuleActions(state.manifest);
  const set = new Set<string>();
  for (const grants of state.roles.grants.values()) {
    for (const g of grants) set.add(g);
  }
  for (const key of state.apiKeys.keys.values()) {
    for (const s of key.scopes) set.add(s);
  }
  return [...set];
}

/**
 * Seed hygiene demos that do not close the setup wizard (no operators).
 * Never-signed-in operators appear once real invites land with lastSeenAt null.
 */
function seedAccessDemoData(
  apiKeys: ApiKeyStore,
  invites: OperatorInviteStore,
  now: () => number,
): void {
  const t = now();
  const staleCreated = t - 100 * 24 * 60 * 60 * 1000;
  if (!apiKeys.keys.has("key_stale")) {
    apiKeys.keys.set("key_stale", {
      id: "key_stale",
      plane: "user",
      hash: "stale",
      name: "Stale unused key",
      scopes: ["member"],
      expiresAt: null,
      rateLimit: null,
      ipAllowlist: [],
      creatorId: "user_demo",
      creatorScopes: ["member"],
      createdAt: staleCreated,
      lastUsedAt: null,
      revokedAt: null,
    });
  }
  if (!invites.invites.has("invite_expired")) {
    invites.invites.set("invite_expired", {
      id: "invite_expired",
      email: "expired@example.com",
      invitedBy: "seed",
      createdAt: t - 14 * 24 * 60 * 60 * 1000,
      expiresAt: t - 24 * 60 * 60 * 1000,
      acceptedAt: null,
    });
  }
}
