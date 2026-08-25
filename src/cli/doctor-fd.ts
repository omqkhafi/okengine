/**
 * `oke doctor` file-descriptor headroom probe.
 *
 * A live-SSE app holds one fd per open subscriber stream; a low `ulimit -n`
 * soft limit collapses under load long before CPU or memory do. Doctor
 * estimates peak concurrent fds from the manifest and compares against the
 * process soft limit.
 */

import { spawnSync } from "node:child_process";
import type { Manifest } from "../manifest/types.ts";

/** Conservative fallback when the soft limit cannot be read. */
const DEFAULT_SOFT_FD_LIMIT = 256;

/** Baseline fds every runtime needs (stdin/out/err, event loop, listeners). */
const BASE_FDS = 64;

/** Expected concurrent subscribers per live signal / SSE route. */
const EXPECTED_SUBSCRIBERS_PER_LIVE = 64;

/**
 * Measured server-side fd cost per open SSE subscriber.
 *
 * Calibrated by the G3b bench (`src/bench/g03-signal-sse-memory.bench.ts`):
 * 1.53 fds/subscriber observed on macOS/Bun across a 100→500 subscriber
 * scale-up. The original formula implicitly budgeted 64 fds/subscriber —
 * off by >20% against this measurement. Remaining conservatism lives in
 * `BASE_FDS` / `HTTP_CONCURRENCY`, not here.
 */
export const FD_COST_PER_SUBSCRIBER: number = 1.5;

/** Pool connections per SQL driver. */
const SQL_CONNECTIONS = 2;

/** Connections held by Redis-style KV drivers. */
const KV_CONNECTIONS = 2;

/** Concurrent in-flight HTTP requests to budget for. */
const HTTP_CONCURRENCY = 128;

/**
 * Read the current soft `NOFILE` limit for this process.
 *
 * Prefers `process.getrlimit` when Bun exposes it; falls back to spawning
 * `sh -c 'ulimit -n'` (which reports the shell's own limit, a close proxy).
 * Returns `null` when neither path works — callers treat that as the
 * conservative {@link DEFAULT_SOFT_FD_LIMIT}.
 */
export function getSoftFdLimit(): number | null {
  const proc = process as typeof process & {
    getrlimit?: (name: string) => { readonly soft: number; readonly hard: number };
  };
  if (typeof proc.getrlimit === "function") {
    try {
      const rl = proc.getrlimit("NOFILE");
      if (rl && Number.isFinite(rl.soft)) return rl.soft;
    } catch {
      // fall through to shell
    }
  }
  try {
    const out = spawnSync("sh", ["-c", "ulimit -n"], { encoding: "utf8" });
    const parsed = Number.parseInt(out.stdout?.trim() ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  } catch {
    // unreadable — caller falls back
  }
  return null;
}

/**
 * Estimate peak concurrent file descriptors from a manifest.
 *
 * Budgets base runtime fds, expected live-signal subscribers (`signals`
 * with `delivery === "live"` plus flows with an http trigger and `live`),
 * pool connections, and HTTP concurrency. Without a manifest, returns a
 * conservative baseline only.
 *
 * @param manifest - Loaded manifest, or `null` when none was found.
 */
export function estimatePeakFds(manifest: Manifest | null): number {
  let need = BASE_FDS + SQL_CONNECTIONS + KV_CONNECTIONS + HTTP_CONCURRENCY;
  if (!manifest) return need;
  const liveSignals = Object.values(manifest.signals ?? {}).filter(
    (signal) => signal.delivery === "live",
  ).length;
  const sseRoutes = Object.values(manifest.flows ?? {}).filter((flow) => {
    if (!flow.live) return false;
    const trigger = flow.trigger?.http;
    return (
      trigger !== undefined &&
      (trigger.method === "GET" || trigger.method === "HEAD" || trigger.method === "QUERY")
    );
  }).length;
  // Live subscribers are the dominant term; budget the busiest signal/route
  // at the expected concurrency times the measured per-subscriber fd cost.
  need += Math.max(liveSignals, sseRoutes) * EXPECTED_SUBSCRIBERS_PER_LIVE * FD_COST_PER_SUBSCRIBER;
  return need;
}

/**
 * Compare the estimated peak fd need against the soft limit.
 *
 * @param manifest - Loaded manifest, or `null` when none was found.
 */
export function checkFileDescriptorHeadroom(manifest: Manifest | null): {
  ok: boolean;
  softLimit: number;
  estimatedNeed: number;
  headroom: number;
} {
  const softLimit = getSoftFdLimit() ?? DEFAULT_SOFT_FD_LIMIT;
  const estimatedNeed = estimatePeakFds(manifest);
  const headroom = softLimit - estimatedNeed;
  return { ok: headroom >= 0, softLimit, estimatedNeed, headroom };
}
