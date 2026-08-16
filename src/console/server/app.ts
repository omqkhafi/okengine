/**
 * ConsoleApp — operator-plane app built on `createClient<ConsoleApp>`.
 */

import { resolve } from "node:path";
import { memorySignalDriver } from "../../drivers/signal-memory.ts";
import { signal as declareSignal } from "../../elements/signal/declare.ts";
import { createSignalRuntime } from "../../elements/signal/runtime.ts";
import { oke, type OkeApp } from "../../kernel/index.ts";
import {
  createRunsRuntime,
  DEFAULT_RUNS_LOCAL_ROOT,
  mergeLiveAndPersistedEvents,
  type RunsRuntime,
} from "../../runs/index.ts";
import { piiFieldNamesFromManifest } from "./runs-pii.ts";
import { runConsoleRunsQuery } from "./runs-query.ts";
import { createManifestAiRuntime } from "./ai.ts";
import { CONSOLE_GATES } from "./console-gates.ts";
import { createConsoleBindings } from "./flows.ts";
import { feedRun } from "./live.ts";
import { consolePlugin } from "./plugin.ts";
import {
  bindAiRuntime,
  bindManifestGateRuntime,
  createConsoleState,
  type ConsoleState,
  type CreateConsoleStateOptions,
} from "./state.ts";
import { createManifestChannelRuntime } from "./channels.ts";
import { createManifestClockRuntime } from "./clock.ts";
import { createManifestStoreRuntime } from "./store.ts";
import { VaultBootError } from "../../elements/vault.ts";
import { createManifestVaultRuntime, resolveVaultDriverId } from "./vault.ts";
import { clearClaimCodeArtifact, printClaimCodeOnce, writeClaimCodeArtifact } from "./claim.ts";

/** Options for {@link createConsoleApp}. */
export interface CreateConsoleAppOptions extends CreateConsoleStateOptions {
  /** Application name (default `console`). */
  readonly name?: string;
}

/** Console application + shared state. */
export interface ConsoleAppHandle {
  /** Typed okengine app (`createClient<typeof app>`). */
  readonly app: OkeApp;
  /** Shared operator / claim / Manifest state. */
  readonly state: ConsoleState;
  /** Adopted route map for `createClient`. */
  readonly routes: ReturnType<typeof createConsoleBindings>["routes"];
}

/**
 * Build the Console application (operator plane, runs enabled).
 *
 * @param options - Secret, cwd, Manifest seed
 */
export function createConsoleApp(options: CreateConsoleAppOptions = {}): ConsoleAppHandle {
  const state = createConsoleState(options);
  // Spec §2.5 — claim is TTY-only while setup is open (no operators yet).
  // `silentClaim` skips stdout (oke dev paints the board itself; tests).
  // The `.oke/claim-code` mirror is always written so `oke console claim-code` works.
  if (!state.setupClosed) {
    writeClaimCodeArtifact(state.cwd, state.claim);
    if (!options.silentClaim) {
      printClaimCodeOnce(state.claim);
    }
  } else {
    clearClaimCodeArtifact(state.cwd);
  }

  const { bindings, routes } = createConsoleBindings(state);

  const app = oke({
    name: options.name ?? "console",
    // Isolated source — leftover host `on()` registrations never enter Console.
    registry: "ignore",
    bindings,
    autoBoot: false,
    fx: { now: state.now },
    gate: {
      auth: {
        secret: state.secret,
        sessions: state.sessions,
        now: state.now,
        // Console owns `/console/session/*` — no app `/auth/*` surfaces.
        http: false,
      },
      policies: [...CONSOLE_GATES],
    },
    runs: { driver: "memory" },
  })
    .plug(consolePlugin())
    .adopt({
      console: {
        setupStatus: routes.setup.status,
        setupClaim: routes.setup.claim,
        sessionLogin: routes.session.login,
        sessionMe: routes.session.me,
        sessionLogout: routes.session.logout,
        manifestGet: routes.manifest.get,
        runsList: routes.runs.list,
        runsQuery: routes.runs.query,
        actionPing: routes.action.ping,
        structuralPropose: routes.structural.propose,
        flowsIdentities: routes.flows.identities,
        flowsInvoke: routes.flows.invoke,
        tracesReplay: routes.traces.replay,
        signalsList: routes.signals.list,
        signalsReplay: routes.signals.replay,
        signalsDryRunReplay: routes.signals.dryRunReplay,
        signalsDiscard: routes.signals.discard,
        storeList: routes.store.list,
        storeQuery: routes.store.query,
        storeReveal: routes.store.reveal,
        storeEdit: routes.store.edit,
        storeDelete: routes.store.delete,
        storePurgeCache: routes.store.purgeCache,
        storeSql: routes.store.sql,
        storePreview: routes.store.preview,
        storeSqlStats: routes.store.stats,
        storeSqlLocks: routes.store.locks,
        storeSqlAdvise: routes.store.advise,
        vaultList: routes.vault.list,
        vaultSet: routes.vault.set,
        vaultCreate: routes.vault.create,
        vaultRotate: routes.vault.rotate,
        vaultRotateMaster: routes.vault.rotateMaster,
        vaultAuditVerify: routes.vault.auditVerify,
        aiList: routes.ai.list,
        gatesList: routes.gates.list,
        gatesSimulate: routes.gates.simulate,
        gatesPowers: routes.gates.powers,
        accessList: routes.access.list,
        accessEffective: routes.access.effective,
        accessKeyBlast: routes.access.keyBlast,
        accessCreateKey: routes.access.createKey,
        accessRevokeKey: routes.access.revokeKey,
        accessRotateKey: routes.access.rotateKey,
        accessSetRoleGrants: routes.access.setRoleGrants,
        diffList: routes.diff.list,
        clockList: routes.clock.list,
        instancesList: routes.instances.list,
        clockRunNow: routes.clock.runNow,
        clockPause: routes.clock.pause,
        clockEditSchedule: routes.clock.editSchedule,
        clockWakeEarly: routes.clock.wakeEarly,
        channelsList: routes.channel.list,
        channelPreview: routes.channel.preview,
        channelVerifyAuth: routes.channel.verifyAuth,
        channelReveal: routes.channel.reveal,
        channelSendTest: routes.channel.sendTest,
      },
    });

  return { app, state, routes };
}

/**
 * Boot the Console app and wire runs + signal inspect to live runtimes.
 *
 * @param handle - Console app handle
 */
export async function bootConsoleApp(handle: ConsoleAppHandle): Promise<OkeApp> {
  await handle.app.boot({ env: "test" });
  wrapConsoleRunsForLive(handle);
  bindConsoleListRuns(handle);
  // Element runtimes bind lazily on first panel access (see ensure* below
  // via list* methods / bindManifest* callers) — not all seventeen at boot.
  return handle.app;
}

/**
 * `listRuns` = live Console memory ∪ host Parquet at `.oke/runs`.
 * Live ingest stays in-process; disk keeps host traces across Console restart.
 * One files runtime is reused for list + sandboxed SQL (Prerequisite C).
 *
 * @param handle - Console app handle
 */
export function bindConsoleListRuns(handle: ConsoleAppHandle): void {
  const root = resolve(handle.state.cwd, DEFAULT_RUNS_LOCAL_ROOT);
  let persisted: RunsRuntime | undefined;

  async function ensurePersisted(): Promise<RunsRuntime> {
    if (!persisted) {
      persisted = createRunsRuntime({
        driver: "files",
        localRoot: root,
        retention: { keep: "forever" },
      });
      await persisted.open();
    }
    return persisted;
  }

  handle.state.listRuns = async () => {
    const live = handle.app.bootResult?.runs ? await handle.app.bootResult.runs.all() : [];
    const disk = await (await ensurePersisted()).all();
    return mergeLiveAndPersistedEvents(live, disk);
  };

  handle.state.queryPersistedRuns = async (input) => {
    const runtime = await ensurePersisted();
    return runConsoleRunsQuery({
      runtime,
      sql: input.sql,
      piiFields: piiFieldNamesFromManifest(handle.state.manifest),
      revealPii: input.revealPii === true,
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.maxRows !== undefined ? { maxRows: input.maxRows } : {}),
    });
  };
}

/**
 * Wrap the Console runs runtime so every recorded wide event is also pushed
 * to `/console/live` subscribers (Flow split-view Traces). Idempotent.
 *
 * Also elides `console.runs.list` outputs on record — listing returns every
 * stored run, so persisting that payload into the same store nests prior
 * lists and doubles size on each poll.
 *
 * @param handle - Console app handle
 */
export function wrapConsoleRunsForLive(handle: ConsoleAppHandle): void {
  const runs = handle.app.bootResult?.runs;
  if (!runs) return;
  const flagged = runs as RunsRuntime & { [RUNS_LIVE_WRAPPED]?: true };
  if (flagged[RUNS_LIVE_WRAPPED]) return;
  const state = handle.state;
  const origRecord = runs.record.bind(runs);
  const origAppend = runs.append.bind(runs);
  runs.record = async (input, archiveCleartext) => {
    // `console.runs.list` returns every stored run — recording that output
    // back into the same store nests prior list payloads and doubles size
    // each poll (live fallback / React Query), OOMing the Console kernel.
    const recordInput =
      input.flow.name === "console.runs.list" || input.flow.name === "console.runs.query"
        ? { ...input, output: undefined }
        : input;
    const event = await origRecord(recordInput, archiveCleartext);
    feedRun(state, event);
    return event;
  };
  runs.append = async (event) => {
    await origAppend(event);
    feedRun(state, event);
  };
  flagged[RUNS_LIVE_WRAPPED] = true;
}

const RUNS_LIVE_WRAPPED = Symbol.for("oke.console.runs.liveWrapped");

/**
 * Ensure Manifest-backed element runtimes for a panel are bound (idempotent).
 *
 * @param state - Console state
 * @param panel - Panel id that was visited
 */
export async function ensureConsolePanelRuntimes(
  state: ConsoleState,
  panel: "signals" | "store" | "vault" | "gates" | "clock" | "ai" | "channels",
): Promise<void> {
  switch (panel) {
    case "signals":
      await bindManifestSignalBus(state);
      break;
    case "store":
      await bindManifestStoreRuntime(state);
      break;
    case "vault":
      await bindManifestVaultRuntime(state);
      break;
    case "gates":
      await bindManifestGateRuntime(state);
      break;
    case "clock":
      await bindManifestClockRuntime(state);
      break;
    case "ai":
      bindManifestAiRuntime(state);
      break;
    case "channels":
      bindManifestChannelRuntime(state);
      break;
  }
}

/**
 * Bind a ChannelRuntime + console inbox from the Manifest when no host
 * runtime is attached — Console surfaces real receipts / inbox, not mocks.
 *
 * @param state - Console state
 */
export function bindManifestChannelRuntime(state: ConsoleState): void {
  if (state.channelRuntime) return;
  if (!state.manifest?.channels || Object.keys(state.manifest.channels).length === 0) {
    return;
  }
  const bound = createManifestChannelRuntime(state.manifest, {
    now: state.now,
    catalog: state.channelCatalog,
    inbox: state.channelInbox ?? undefined,
  });
  state.channelRuntime = bound.runtime;
  state.channelInbox = bound.inbox;
}

/**
 * Open a ClockRuntime from Manifest clocks when no host runtime is attached.
 *
 * @param state - Console state
 */
export async function bindManifestClockRuntime(state: ConsoleState): Promise<void> {
  if (state.clockRuntime) return;
  const hasClocks =
    (state.manifest?.clocks && Object.keys(state.manifest.clocks).length > 0) ||
    Object.values(state.manifest?.flows ?? {}).some((f) => f.trigger?.cron || f.trigger?.every);
  if (!hasClocks) return;
  state.clockRuntime = createManifestClockRuntime(state.manifest, {
    now: state.now,
  });
  await state.clockRuntime.reconcile();
}

/**
 * Bind an AiRuntime from the Manifest when no host runtime is attached.
 *
 * @param state - Console state
 */
export function bindManifestAiRuntime(state: ConsoleState): void {
  if (state.aiRuntime) return;
  const hasAi =
    state.manifest?.ai &&
    (Object.keys(state.manifest.ai.prompts ?? {}).length > 0 ||
      Object.keys(state.manifest.ai.agents ?? {}).length > 0 ||
      Object.keys(state.manifest.ai.models ?? {}).length > 0);
  if (!hasAi) return;
  bindAiRuntime(state, createManifestAiRuntime(state.manifest, { now: state.now }));
}

/**
 * Open a VaultRuntime from the Manifest when no host runtime is attached.
 * Uses the standard resolution chain (driver → process.env → .env.local)
 * — Console never parses dotenv itself.
 *
 * @param state - Console state
 */
export async function bindManifestVaultRuntime(state: ConsoleState): Promise<void> {
  if (state.vaultRuntime) return;
  const { loadVaultOverlay } = await import("./vault-overlay.ts");
  const overlay = await loadVaultOverlay(state.cwd);
  const hasManifest = Boolean(
    state.manifest?.vault && Object.keys(state.manifest.vault).length > 0,
  );
  if (!hasManifest && overlay.length === 0) {
    return;
  }
  const env = state.production ? "prod" : "dev";
  try {
    const layers = state.vaultLayerSeed;
    state.vaultRuntime = await createManifestVaultRuntime(state.manifest, {
      cwd: state.cwd,
      env,
      allowDevFallbacks: !state.production,
      now: state.now,
      driverId: resolveVaultDriverId(state.okeConfig, env),
      ...(layers?.driver !== undefined ? { seed: layers.driver } : {}),
      ...(layers === null
        ? {}
        : {
            overlays: {
              ...(layers.processEnv !== undefined ? { "process.env": layers.processEnv } : {}),
              ...(layers.envLocal !== undefined ? { ".env.local": layers.envLocal } : {}),
            },
            ...(layers.devFallback !== undefined ? { devFallbacks: layers.devFallback } : {}),
          }),
    });
  } catch (err) {
    // Gaps are a doctor concern — Console still lists contracts from Manifest.
    if (!(err instanceof VaultBootError)) throw err;
    state.vaultRuntime = null;
  }
}

/**
 * Open a memory StoreRuntime from the Manifest when no host runtime is attached.
 *
 * @param state - Console state
 */
export async function bindManifestStoreRuntime(state: ConsoleState): Promise<void> {
  if (state.storeRuntime) return;
  if (!state.manifest?.stores || Object.keys(state.manifest.stores).length === 0) {
    return;
  }
  state.storeRuntime = await createManifestStoreRuntime(state.manifest, state.now);
}

/**
 * Open a memory signal bus from the Manifest snapshot when no host bus
 * is attached — Console still reads real delivery physics, not a mock UI.
 *
 * @param state - Console state
 */
export async function bindManifestSignalBus(state: ConsoleState): Promise<void> {
  if (state.signalBus) return;
  const declared = Object.entries(state.manifest?.signals ?? {});
  if (declared.length === 0) return;
  const runtime = createSignalRuntime({
    driver: memorySignalDriver,
    now: state.now,
  });
  for (const [name, s] of declared) {
    runtime.register(
      declareSignal(name, {
        delivery: s.delivery,
        retries: s.retries,
        deadLetter: s.deadLetter,
        schema: s.schema,
        optional: s.optional,
      }),
    );
  }
  state.signalBus = await runtime.start();
}

/** Type alias for `createClient<ConsoleApp>`. */
export type ConsoleApp = OkeApp;
