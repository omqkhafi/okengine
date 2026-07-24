/**
 * ConsoleApp — operator-plane app built on `createClient<ConsoleApp>`.
 */

import { auth } from "../../auth/index.ts";
import { oke, type OkeApp } from "../../kernel/index.ts";
import { createConsoleBindings } from "./flows.ts";
import { consolePlugin } from "./plugin.ts";
import {
  createConsoleState,
  type ConsoleState,
  type CreateConsoleStateOptions,
} from "./state.ts";
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
      },
    });

  return { app, state, routes };
}

/**
 * Boot the Console app and wire `state.listRuns` to the runs runtime.
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
  return handle.app;
}

/** Type alias for `createClient<ConsoleApp>`. */
export type ConsoleApp = OkeApp;
