/**
 * Push host WideEvents into Console's runs ingest (oke dev live Traces bridge).
 *
 * Host and Console are separate processes — this never shares a memory
 * RunsRuntime across processes. Console appends into its own store, which
 * already wraps into `feedRun` → `projectRun` (PII-masked) for UI/live.
 */

import type { RunsRuntime } from "./runtime.ts";
import type { WideEvent } from "./types.ts";

/** HTTP header carrying the shared ingest secret. */
export const RUNS_INGEST_SECRET_HEADER = "x-oke-runs-ingest";

/** Env keys set by `oke dev` on the host child. */
export const RUNS_INGEST_URL_ENV = "OKE_RUNS_INGEST_URL";
/** Shared secret env for host → Console ingest. */
export const RUNS_INGEST_SECRET_ENV = "OKE_RUNS_INGEST_SECRET";

/** Fetch function used by {@link wrapRunsForConsoleIngest} (tests inject). */
export type RunsConsoleBridgeFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Target for {@link wrapRunsForConsoleIngest}. */
export interface RunsConsoleBridgeTarget {
  /** Absolute ingest URL (`http://127.0.0.1:6533/console/runs/ingest`). */
  readonly url: string;
  /** Shared secret (must match Console `runsIngestSecret`). */
  readonly secret: string;
  /** Injected fetch (tests). Defaults to `globalThis.fetch`. */
  readonly fetch?: RunsConsoleBridgeFetch;
}

/**
 * Resolve a Console ingest bridge from boot options or process env.
 *
 * @param explicit - Boot-level override (`false` disables env lookup)
 */
export function resolveRunsConsoleBridge(
  explicit?: RunsConsoleBridgeTarget | false,
): RunsConsoleBridgeTarget | null {
  if (explicit === false) return null;
  if (explicit) return explicit;
  const url = process.env[RUNS_INGEST_URL_ENV];
  const secret = process.env[RUNS_INGEST_SECRET_ENV];
  if (url === undefined || url.length === 0) return null;
  if (secret === undefined || secret.length === 0) return null;
  return { url, secret };
}

/**
 * Wrap a runs runtime so every recorded/appended WideEvent is POSTed to
 * Console ingest. Failures are swallowed — host execution must not depend
 * on Console availability.
 *
 * @param runs - Host runs runtime
 * @param target - Console ingest URL + secret
 */
export function wrapRunsForConsoleIngest(
  runs: RunsRuntime,
  target: RunsConsoleBridgeTarget,
): RunsRuntime {
  const flagged = runs as RunsRuntime & { [RUNS_BRIDGE_WRAPPED]?: true };
  if (flagged[RUNS_BRIDGE_WRAPPED]) return runs;

  const fetchFn: RunsConsoleBridgeFetch =
    target.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const origRecord = runs.record.bind(runs);
  const origAppend = runs.append.bind(runs);

  async function push(event: WideEvent): Promise<void> {
    try {
      await fetchFn(target.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [RUNS_INGEST_SECRET_HEADER]: target.secret,
        },
        body: JSON.stringify({ event }),
      });
    } catch {
      // Console may be restarting — host traffic continues.
    }
  }

  runs.record = async (input, archiveCleartext) => {
    const event = await origRecord(input, archiveCleartext);
    // Await localhost ingest so Traces stay coherent; failures stay soft.
    await push(event);
    return event;
  };
  runs.append = async (event) => {
    await origAppend(event);
    await push(event);
  };
  flagged[RUNS_BRIDGE_WRAPPED] = true;
  return runs;
}

const RUNS_BRIDGE_WRAPPED = Symbol.for("oke.runs.consoleBridgeWrapped");
