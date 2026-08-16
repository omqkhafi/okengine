/**
 * Bind the host `oke()` app into Console so Store / Call API use the live
 * compose runtime — not the Manifest memory sandbox.
 *
 * `oke dev` serves Console in the parent and the app in a child. Without
 * this attach, `console.flows.invoke` fails closed (`InvokeDenied`),
 * Store SQL queries an empty memory `sql:db`, and Call API runs never
 * reach Traces.
 */

import { pathToFileURL } from "node:url";
import { bindHostInvokeUserFlow } from "../console/server/invoke-user-flow.ts";
import { bindAiRuntime, type ConsoleState } from "../console/server/state.ts";
import type { OkeApp } from "../kernel/app.ts";
import { findAppWithPlugins } from "../elements/store/load-plugin-tables.ts";
import type { RunsConsoleBridgeTarget } from "../runs/bridge-to-console.ts";

/** Stop handle for the in-process host boot. */
export interface AttachedHost {
  readonly stop: () => Promise<void>;
}

/** Options for {@link attachHostToConsole}. */
export interface AttachHostToConsoleOptions {
  /** Absolute app entry (`src/app.ts`). */
  readonly entry: string;
  /** Project root (effects extract + compose URLs). */
  readonly cwd: string;
  /** Live Console state to mutate. */
  readonly state: ConsoleState;
  /**
   * Host → Console WideEvent ingest (`oke dev` Traces). Without this,
   * Call API execute records only in the in-process host and never
   * appears next to child-process clock ticks.
   */
  readonly runsBridge?: RunsConsoleBridgeTarget;
}

/**
 * Import and boot the host app in-process (no scheduler / no listen).
 * Wires invoke-as and replaces the memory store sandbox with the host store.
 *
 * @param options - Entry, cwd, Console state
 * @returns Stop handle, or `null` when the entry is not a bootable app
 */
export async function attachHostToConsole(
  options: AttachHostToConsoleOptions,
): Promise<AttachedHost | null> {
  const mod = (await import(pathToFileURL(options.entry).href)) as Record<string, unknown>;
  const host = findBootableApp(mod);
  if (!host) return null;

  const docker = process.env.OKE_DOCKER === "1";
  await host.boot({
    env: docker ? "dev" : "test",
    docker,
    startScheduler: false,
    rootDir: options.cwd,
    ...(options.runsBridge !== undefined ? { runsBridge: options.runsBridge } : {}),
  });

  options.state.invokeUserFlow = bindHostInvokeUserFlow(host);
  const store = host.elements?.store ?? host.bootResult?.store;
  if (store) options.state.storeRuntime = store;
  const vault = host.elements?.vault ?? host.bootResult?.vault;
  if (vault) options.state.vaultRuntime = vault;
  const ai = host.elements?.ai ?? host.bootResult?.ai;
  if (ai) bindAiRuntime(options.state, ai);

  return {
    stop: async () => {
      options.state.invokeUserFlow = null;
      await host.stop();
    },
  };
}

function findBootableApp(mod: Record<string, unknown>): OkeApp | undefined {
  const plugged = findAppWithPlugins(mod);
  if (plugged && isBootableApp(plugged)) return plugged;
  for (const key of ["app", "default", ...Object.keys(mod)]) {
    const value = mod[key];
    if (isBootableApp(value)) return value;
  }
  return undefined;
}

function isBootableApp(value: unknown): value is OkeApp {
  if (!value || typeof value !== "object") return false;
  const o = value as { boot?: unknown; stop?: unknown; execute?: unknown; bindings?: unknown };
  return (
    typeof o.boot === "function" &&
    typeof o.stop === "function" &&
    typeof o.execute === "function" &&
    Array.isArray(o.bindings)
  );
}
