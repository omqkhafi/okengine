/**
 * ConsoleApp — operator-plane app built on `createClient<ConsoleApp>`.
 */

import { auth } from "../../auth/index.ts";
import { memorySignalDriver } from "../../drivers/signal-memory.ts";
import { signal as declareSignal } from "../../elements/signal/declare.ts";
import { createSignalRuntime } from "../../elements/signal/runtime.ts";
import { oke, type OkeApp } from "../../kernel/index.ts";
import { createConsoleBindings } from "./flows.ts";
import { consolePlugin } from "./plugin.ts";
import {
  createConsoleState,
  type ConsoleState,
  type CreateConsoleStateOptions,
} from "./state.ts";
import { createManifestStoreRuntime } from "./store.ts";
import { printClaimCodeOnce } from "./claim.ts";

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
export function createConsoleApp(
  options: CreateConsoleAppOptions = {},
): ConsoleAppHandle {
  const state = createConsoleState(options);
  if (!options.silentClaim) {
    printClaimCodeOnce(state.claim);
  }

  const { bindings, routes } = createConsoleBindings(state);

  const app = oke({
    name: options.name ?? "console",
    bindings,
    autoBoot: false,
    fx: { now: state.now },
    auth: {
      secret: state.secret,
      sessions: state.sessions,
      now: state.now,
    },
    runs: { driver: "memory" },
  })
    .plug(auth({ secret: state.secret }))
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
      },
    });

  return { app, state, routes };
}

/**
 * Boot the Console app and wire runs + signal inspect to live runtimes.
 *
 * @param handle - Console app handle
 */
export async function bootConsoleApp(
  handle: ConsoleAppHandle,
): Promise<OkeApp> {
  await handle.app.boot({ env: "test" });
  handle.state.listRuns = async () => {
    const runs = handle.app.bootResult?.runs;
    if (!runs) return [];
    return runs.all();
  };
  await bindManifestSignalBus(handle.state);
  await bindManifestStoreRuntime(handle.state);
  return handle.app;
}

/**
 * Open a memory StoreRuntime from the Manifest when no host runtime is attached.
 *
 * @param state - Console state
 */
export async function bindManifestStoreRuntime(
  state: ConsoleState,
): Promise<void> {
  if (state.storeRuntime) return;
  if (!state.manifest?.stores || Object.keys(state.manifest.stores).length === 0) {
    return;
  }
  state.storeRuntime = await createManifestStoreRuntime(
    state.manifest,
    state.now,
  );
}

/**
 * Open a memory signal bus from the Manifest snapshot when no host bus
 * is attached — Console still reads real delivery physics, not a mock UI.
 *
 * @param state - Console state
 */
export async function bindManifestSignalBus(
  state: ConsoleState,
): Promise<void> {
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
