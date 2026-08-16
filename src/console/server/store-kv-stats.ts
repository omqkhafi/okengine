/**
 * Store KV engine telemetry — Redis-wire INFO / COMMANDSTATS / SLOWLOG / LATENCY.
 *
 * Zero custom recording. `memory` is unsupported (same honesty as pglite for
 * SQL). INFO is instance-wide ({@link STORE_KV_STATS_SERVER_WIDE_GAP}).
 * SLOWLOG args are keys and values ({@link STORE_KV_STATS_SLOWLOG_ARGS_GAP}).
 * No MONITOR. No invented hot-key table.
 */

import type { KvNamespace } from "../../drivers/types.ts";
import type { StoreRuntime } from "../../elements/store.ts";
import type { ResourceRef } from "../../manifest/types.ts";

/** INFO / COMMANDSTATS / LATENCY are the whole Redis instance, not `oke:kv:{ns}:`. */
export const STORE_KV_STATS_SERVER_WIDE_GAP = "StoreKvStatsServerWideGap" as const;

/** SLOWLOG command args include keys and values. */
export const STORE_KV_STATS_SLOWLOG_ARGS_GAP = "StoreKvStatsSlowlogArgsGap" as const;

/** Driver or vendor does not expose Redis-wire introspection. */
export const KV_STATS_UNSUPPORTED = "KvStatsUnsupported" as const;

/** Placeholder when SLOWLOG args are collapsed. */
export const STORE_KV_SLOWLOG_ARG_REDACTED = "[redacted]";

/** SLOWLOG row cap. */
export const STORE_KV_SLOWLOG_LIMIT = 128;

/** Commands this endpoint sends — never MONITOR. */
export const STORE_KV_STATS_COMMANDS = ["INFO", "SLOWLOG", "LATENCY"] as const;

/** Structured telemetry failure (HTTP error code = {@link StoreKvStatsError.code}). */
export class StoreKvStatsError extends Error {
  readonly code: typeof KV_STATS_UNSUPPORTED;

  /**
   * @param code - Structured code
   * @param message - Engine or classifier message
   */
  constructor(code: typeof KV_STATS_UNSUPPORTED, message: string) {
    super(message);
    this.name = "StoreKvStatsError";
    this.code = code;
  }
}

/** Cluster KPIs from INFO stats (null when the field is missing). */
export interface StoreKvStatsKpis {
  readonly hitRate: number | null;
  readonly opsPerSec: number | null;
  readonly evictedKeys: number | null;
  readonly expiredKeys: number | null;
}

/** One INFO commandstats row. */
export interface StoreKvCommandStatRow {
  readonly command: string;
  readonly calls: number;
  readonly usec: number;
  readonly usecPerCall: number | null;
}

/** One SLOWLOG row (args collapsed unless reveal). */
export interface StoreKvSlowlogRow {
  readonly id: number;
  readonly timestamp: number;
  readonly durationUs: number;
  readonly command: string;
  readonly args: readonly string[];
}

/** One LATENCY LATEST row — missing Dragonfly fields stay null. */
export interface StoreKvLatencyRow {
  readonly event: string;
  readonly latestUs: number | null;
  readonly allTimeUs: number | null;
}

/** `QUERY /console/store/kv/stats` payload. */
export interface StoreKvStatsResult {
  readonly engine: "redis" | "memory";
  readonly kpis: StoreKvStatsKpis;
  readonly commands: readonly StoreKvCommandStatRow[];
  readonly slowlog: readonly StoreKvSlowlogRow[];
  readonly latency: readonly StoreKvLatencyRow[];
  readonly limitation: typeof STORE_KV_STATS_SERVER_WIDE_GAP;
  readonly slowlogLimitation: typeof STORE_KV_STATS_SLOWLOG_ARGS_GAP;
  readonly masked: boolean;
  readonly namespacePrefix: string;
}

/**
 * Redis key prefix for one OKE KV namespace.
 *
 * @param name - Namespace name (`cache` from `kv:cache`)
 */
export function kvNamespacePrefix(name: string): string {
  return `oke:kv:${name}:`;
}

/**
 * Parse a Redis INFO bulk string into a field map (section headers ignored).
 *
 * @param raw - INFO reply
 */
export function parseRedisInfo(raw: unknown): Readonly<Record<string, string>> {
  const text = asText(raw);
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Read a numeric INFO field; missing / non-numeric → null (Dragonfly gaps).
 *
 * @param fields - Parsed INFO
 * @param key - Field name
 */
export function infoNumber(fields: Readonly<Record<string, string>>, key: string): number | null {
  const raw = fields[key];
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * KPI rollup from INFO stats fields.
 *
 * @param fields - Parsed INFO
 */
export function computeKvStatsKpis(fields: Readonly<Record<string, string>>): StoreKvStatsKpis {
  const hits = infoNumber(fields, "keyspace_hits");
  const misses = infoNumber(fields, "keyspace_misses");
  const total = hits !== null && misses !== null ? hits + misses : null;
  return {
    hitRate: hits !== null && total !== null && total > 0 ? hits / total : null,
    opsPerSec: infoNumber(fields, "instantaneous_ops_per_sec"),
    evictedKeys: infoNumber(fields, "evicted_keys"),
    expiredKeys: infoNumber(fields, "expired_keys"),
  };
}

/**
 * Parse `cmdstat_*` lines from INFO commandstats.
 *
 * @param fields - Parsed INFO
 */
export function parseCommandStats(
  fields: Readonly<Record<string, string>>,
): readonly StoreKvCommandStatRow[] {
  const rows: StoreKvCommandStatRow[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!key.startsWith("cmdstat_")) continue;
    const command = key.slice("cmdstat_".length);
    const parts = Object.fromEntries(
      value.split(",").map((pair) => {
        const eq = pair.indexOf("=");
        return eq === -1 ? [pair, ""] : [pair.slice(0, eq), pair.slice(eq + 1)];
      }),
    );
    const calls = Number(parts.calls ?? "");
    const usec = Number(parts.usec ?? "");
    const usecPerCall = Number(parts.usec_per_call ?? "");
    rows.push({
      command,
      calls: Number.isFinite(calls) ? calls : 0,
      usec: Number.isFinite(usec) ? usec : 0,
      usecPerCall: Number.isFinite(usecPerCall) ? usecPerCall : null,
    });
  }
  return rows.sort((a, b) => b.usec - a.usec);
}

/**
 * Parse a SLOWLOG GET reply into rows (args still raw).
 *
 * @param raw - SLOWLOG GET reply
 */
export function parseSlowlog(raw: unknown): readonly StoreKvSlowlogRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: StoreKvSlowlogRow[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 4) continue;
    const id = Number(entry[0]);
    const timestamp = Number(entry[1]);
    const durationUs = Number(entry[2]);
    const argv = Array.isArray(entry[3]) ? entry[3].map((a) => asText(a)) : [];
    const command = argv[0] ?? "";
    rows.push({
      id: Number.isFinite(id) ? id : 0,
      timestamp: Number.isFinite(timestamp) ? timestamp : 0,
      durationUs: Number.isFinite(durationUs) ? durationUs : 0,
      command,
      args: argv.slice(1),
    });
  }
  return rows;
}

/**
 * Keep SLOWLOG rows that mention this namespace prefix (introspection filter).
 *
 * @param rows - Parsed slowlog
 * @param prefix - `oke:kv:{ns}:`
 */
export function filterSlowlogByPrefix(
  rows: readonly StoreKvSlowlogRow[],
  prefix: string,
): readonly StoreKvSlowlogRow[] {
  if (!prefix) return rows;
  return rows.filter((row) => row.args.some((arg) => arg.startsWith(prefix)));
}

/**
 * Collapse SLOWLOG args unless reveal is on.
 *
 * @param rows - Filtered slowlog
 * @param reveal - Audited cleartext
 */
export function redactSlowlogArgs(
  rows: readonly StoreKvSlowlogRow[],
  reveal: boolean,
): readonly StoreKvSlowlogRow[] {
  if (reveal) return rows;
  return rows.map((row) => ({
    ...row,
    args: row.args.map((arg) => (arg.length === 0 ? arg : STORE_KV_SLOWLOG_ARG_REDACTED)),
  }));
}

/**
 * Parse LATENCY LATEST. Missing / unshaped replies → empty (Dragonfly).
 *
 * @param raw - LATENCY LATEST reply
 */
export function parseLatencyLatest(raw: unknown): readonly StoreKvLatencyRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: StoreKvLatencyRow[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 1) continue;
    const event = asText(entry[0]);
    if (!event) continue;
    const latest = entry.length > 2 ? Number(entry[2]) : Number.NaN;
    const allTime = entry.length > 3 ? Number(entry[3]) : Number.NaN;
    rows.push({
      event,
      latestUs: Number.isFinite(latest) ? latest : null,
      allTimeUs: Number.isFinite(allTime) ? allTime : null,
    });
  }
  return rows;
}

/**
 * Read Redis-wire KV telemetry. `memory` fails structured unsupported.
 *
 * @param runtime - Store runtime
 * @param ref - KV store ref (`kv:cache`)
 * @param options - Reveal SLOWLOG args
 */
export async function queryStoreKvStats(
  runtime: StoreRuntime,
  ref: ResourceRef,
  options: { readonly revealPii?: boolean } = {},
): Promise<StoreKvStatsResult> {
  const name = kvNameFromRef(ref);
  const prefix = kvNamespacePrefix(name);
  const ns = await openKvNamespace(runtime, ref);
  if (ns.driverId !== "redis" || typeof ns.send !== "function") {
    throw new StoreKvStatsError(
      KV_STATS_UNSUPPORTED,
      `KV stats require the redis driver (got ${ns.driverId})`,
    );
  }

  const reveal = options.revealPii === true;
  const send = ns.send.bind(ns);
  const statsInfo = parseRedisInfo(await send("INFO", ["stats"]));
  let commandFields: Readonly<Record<string, string>> = {};
  try {
    commandFields = parseRedisInfo(await send("INFO", ["commandstats"]));
  } catch {
    commandFields = {};
  }
  const slowRaw = await send("SLOWLOG", ["GET", String(STORE_KV_SLOWLOG_LIMIT)]);
  let latencyRaw: unknown = [];
  try {
    latencyRaw = await send("LATENCY", ["LATEST"]);
  } catch {
    latencyRaw = [];
  }

  const filtered = filterSlowlogByPrefix(parseSlowlog(slowRaw), prefix);
  return {
    engine: "redis",
    kpis: computeKvStatsKpis(statsInfo),
    commands: parseCommandStats(commandFields),
    slowlog: redactSlowlogArgs(filtered, reveal),
    latency: parseLatencyLatest(latencyRaw),
    limitation: STORE_KV_STATS_SERVER_WIDE_GAP,
    slowlogLimitation: STORE_KV_STATS_SLOWLOG_ARGS_GAP,
    masked: !reveal,
    namespacePrefix: prefix,
  };
}

async function openKvNamespace(runtime: StoreRuntime, ref: ResourceRef): Promise<KvNamespace> {
  try {
    return await runtime.kvNamespace(ref);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("unknown")) {
      throw new StoreKvStatsError(KV_STATS_UNSUPPORTED, message);
    }
    throw err;
  }
}

function kvNameFromRef(ref: ResourceRef): string {
  if (!ref.startsWith("kv:")) {
    throw new StoreKvStatsError(KV_STATS_UNSUPPORTED, `KV stats require a kv:* ref (got ${ref})`);
  }
  return ref.slice(3);
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  if (value == null) return "";
  return String(value);
}
