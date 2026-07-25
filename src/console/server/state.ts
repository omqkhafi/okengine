/**
 * Console server state — operators, sessions, claim code, Manifest snapshot.
 */

import {
  createOperatorStore,
  createSessionStore,
  type OperatorStore,
  type SessionStore,
} from "../../auth/index.ts";
import type {
  SignalBus,
  SignalDiscardOptions,
  SignalReplayOptions,
  SignalReplayResult,
} from "../../drivers/signal-types.ts";
import {
  createMemorySignalConfigStore,
  type SignalConfigStore,
} from "../../elements/signal/reconcile.ts";
import type { Manifest } from "../../manifest/types.ts";
import type { WideEvent } from "../../runs/types.ts";
import { mintClaimCode, type ClaimCodeState } from "./claim.ts";
import {
  discardViaBus,
  projectSignalsList,
  replayViaBus,
  type ConsoleSignalRow,
} from "./signals.ts";
import {
  createManifestStoreRuntime,
  deleteStore,
  editStore,
  projectStoresList,
  purgeStoreCache,
  queryStore,
  runStoreSql,
  type ConsoleStoreRow,
  type StoreDeleteInput,
  type StoreEditInput,
  type StoreQueryInput,
  type StoreQueryResult,
} from "./store.ts";
import type { StoreRuntime } from "../../elements/store.ts";
import type { ResourceRef } from "../../manifest/types.ts";

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
  /** Live-channel subscribers. */
  readonly liveSubscribers: Set<(msg: ConsoleLiveMessage) => void>;
  /** Bound after Console app boot — reads the runs store. */
  listRuns: () => Promise<WideEvent[]>;
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
  discardSignals: (
    options: SignalDiscardOptions,
  ) => Promise<{ readonly discarded: number }>;
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
  /** Direct edit (not a flow execution). */
  editStore: (
    input: StoreEditInput,
    options?: { readonly dryRun?: boolean },
  ) => Promise<Awaited<ReturnType<typeof editStore>>>;
  /** Delete rows/keys. */
  deleteStore: (
    input: StoreDeleteInput,
  ) => Promise<{ readonly deleted: number }>;
  /** Purge cache keys for a resource. */
  purgeStoreCache: (
    resource: ResourceRef,
  ) => Promise<{ readonly keys: readonly string[] }>;
  /** Raw SQL console. */
  runStoreSql: (
    ref: ResourceRef,
    sqlText: string,
    options: {
      readonly allowWrite: boolean;
      readonly revealPii?: boolean;
      readonly tenant?: string;
    },
  ) => Promise<{
    readonly rows: readonly Record<string, unknown>[];
    readonly masked: boolean;
    readonly routedRole: "primary" | "replica";
  }>;
  /** User-plane identities available for invoke-as. */
  readonly identities: ConsoleIdentity[];
  /** Whether this process is treated as production (typed confirm). */
  readonly production: boolean;
  /** Whether first operator exists (wizard permanently closed). */
  get setupClosed(): boolean;
}

/** Live channel message kinds. */
export type ConsoleLiveMessage =
  | { readonly type: "manifest"; readonly manifest: Manifest }
  | {
      readonly type: "manifest.diff";
      readonly before: Manifest;
      readonly after: Manifest;
    }
  | { readonly type: "ping"; readonly at: number };

/** Options for {@link createConsoleState}. */
export interface CreateConsoleStateOptions {
  readonly secret?: string;
  readonly now?: () => number;
  readonly cwd?: string;
  readonly manifest?: Manifest | null;
  /** Skip printing the claim code (tests). */
  readonly silentClaim?: boolean;
  /** Seed identities for the invoke-as picker. */
  readonly identities?: readonly ConsoleIdentity[];
  /** Production flag — irreversible invokes require typed confirm. */
  readonly production?: boolean;
}

/**
 * Create Console state and mint a claim code for this boot.
 *
 * @param options - Secret, clock, cwd
 */
export function createConsoleState(
  options: CreateConsoleStateOptions = {},
): ConsoleState {
  const secret =
    options.secret ??
    process.env.OKE_CONSOLE_SECRET ??
    `oke-console-dev-${crypto.randomUUID()}`;
  const now = options.now ?? (() => Date.now());
  const claim = mintClaimCode(now);
  const operators = createOperatorStore();
  const sessions = createSessionStore();
  const liveSubscribers = new Set<(msg: ConsoleLiveMessage) => void>();

  const signalConfig = createMemorySignalConfigStore();

  const state: ConsoleState = {
    operators,
    sessions,
    claim,
    secret,
    now,
    cwd: options.cwd ?? process.cwd(),
    manifest: options.manifest ?? null,
    liveSubscribers,
    listRuns: async () => [],
    signalConfig,
    signalBus: null,
    listSignals: async () => {
      const runs = await state.listRuns();
      return projectSignalsList({
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
      return replayViaBus(state.signalBus, opts);
    },
    discardSignals: async (opts) => {
      if (!state.signalBus) return { discarded: 0 };
      return discardViaBus(state.signalBus, opts);
    },
    storeRuntime: null,
    listStores: async () => {
      const runs = await state.listRuns();
      return projectStoresList({
        manifest: state.manifest,
        runtime: state.storeRuntime,
        cwd: state.cwd,
        runs: runs.map((r) => ({
          flow: r.flow,
          replicaLagMs: r.replicaLagMs,
          tenant: r.tenant,
          effects: r.effects.map((e) => ({
            kind: e.kind,
            resource: e.resource,
          })),
        })),
      });
    },
    queryStore: async (input) => {
      if (!state.storeRuntime) {
        return { facet: input.ref.split(":")[0] as "sql", rows: [], masked: true };
      }
      return queryStore(state.storeRuntime, state.manifest, input);
    },
    editStore: async (input, opts) => {
      if (!state.storeRuntime) {
        throw new Error("Store runtime not bound");
      }
      return editStore(state.storeRuntime, state.manifest, input, {
        production: state.production,
        dryRun: opts?.dryRun,
      });
    },
    deleteStore: async (input) => {
      if (!state.storeRuntime) return { deleted: 0 };
      return deleteStore(state.storeRuntime, input);
    },
    purgeStoreCache: async (resource) => {
      if (!state.storeRuntime) return { keys: [] };
      return purgeStoreCache(state.storeRuntime, resource);
    },
    runStoreSql: async (ref, sqlText, options) => {
      if (!state.storeRuntime) {
        throw new Error("Store runtime not bound");
      }
      return runStoreSql(state.storeRuntime, ref, sqlText, options);
    },
    identities: [...(options.identities ?? defaultDevIdentities())],
    production: options.production ?? process.env.NODE_ENV === "production",
    get setupClosed() {
      return operators.operators.size > 0;
    },
  };

  return state;
}

/**
 * Publish a live message to all WebSocket / channel subscribers.
 *
 * @param state - Console state
 * @param message - Payload
 */
export function publishLive(
  state: ConsoleState,
  message: ConsoleLiveMessage,
): void {
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
  state.manifest = manifest;
  publishLive(state, { type: "manifest", manifest });
  if (before) {
    publishLive(state, { type: "manifest.diff", before, after: manifest });
  }
}

/**
 * Default development identities for the invoke-as picker.
 */
function defaultDevIdentities(): ConsoleIdentity[] {
  return [
    {
      id: "user_demo",
      email: "demo@example.com",
      name: "Demo User",
      status: "active",
      scopes: ["booking:create", "member"],
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
