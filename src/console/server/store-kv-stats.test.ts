/**
 * Store KV engine telemetry — INFO parse, memory unsupported, SLOWLOG redact.
 */

import { describe, expect, test } from "bun:test";
import type { KvNamespace } from "../../drivers/types.ts";
import type { StoreRuntime } from "../../elements/store.ts";
import type { Manifest } from "../../manifest/types.ts";
import { createManifestStoreRuntime } from "./store.ts";
import {
  computeKvStatsKpis,
  filterSlowlogByPrefix,
  infoNumber,
  KV_STATS_UNSUPPORTED,
  parseCommandStats,
  parseLatencyLatest,
  parseRedisInfo,
  parseSlowlog,
  queryStoreKvStats,
  redactSlowlogArgs,
  STORE_KV_SLOWLOG_ARG_REDACTED,
  STORE_KV_STATS_COMMANDS,
  STORE_KV_STATS_SERVER_WIDE_GAP,
  STORE_KV_STATS_SLOWLOG_ARGS_GAP,
  StoreKvStatsError,
} from "./store-kv-stats.ts";

const REDIS_INFO = `# Stats
total_connections_received:12
keyspace_hits:80
keyspace_misses:20
instantaneous_ops_per_sec:7
evicted_keys:3
expired_keys:5
`;

const DRAGONFLY_INFO = `# Stats
total_connections_received:1
keyspace_hits:10
`;

const COMMANDSTATS_INFO = `# Commandstats
cmdstat_get:calls=10,usec=100,usec_per_call=10.00
cmdstat_set:calls=2,usec=40,usec_per_call=20.00
`;

const SLOWLOG = [
  [
    1,
    1_710_000_000,
    15_000,
    ["SET", "oke:kv:cache:user:1", '{"email":"a@oke.com"}'],
    "127.0.0.1:1",
    "",
  ],
  [2, 1_710_000_001, 80, ["GET", "other:key"], "127.0.0.1:1", ""],
  [3, 1_710_000_002, 9_000, ["GET", "oke:kv:cache:session"], "127.0.0.1:1", ""],
];

describe("parseRedisInfo", () => {
  test("reads Redis-shaped stats fields", () => {
    const fields = parseRedisInfo(REDIS_INFO);
    expect(infoNumber(fields, "keyspace_hits")).toBe(80);
    expect(infoNumber(fields, "keyspace_misses")).toBe(20);
    expect(infoNumber(fields, "instantaneous_ops_per_sec")).toBe(7);
    const kpis = computeKvStatsKpis(fields);
    expect(kpis.hitRate).toBeCloseTo(0.8);
    expect(kpis.opsPerSec).toBe(7);
    expect(kpis.evictedKeys).toBe(3);
    expect(kpis.expiredKeys).toBe(5);
  });

  test("missing Dragonfly fields stay null — not invented", () => {
    const fields = parseRedisInfo(DRAGONFLY_INFO);
    expect(infoNumber(fields, "keyspace_misses")).toBeNull();
    expect(infoNumber(fields, "evicted_keys")).toBeNull();
    const kpis = computeKvStatsKpis(fields);
    expect(kpis.hitRate).toBeNull();
    expect(kpis.opsPerSec).toBeNull();
    expect(kpis.evictedKeys).toBeNull();
    expect(kpis.expiredKeys).toBeNull();
  });
});

describe("parseCommandStats", () => {
  test("sorts by usec descending", () => {
    const rows = parseCommandStats(parseRedisInfo(COMMANDSTATS_INFO));
    expect(rows.map((r) => r.command)).toEqual(["get", "set"]);
    expect(rows[0]!.calls).toBe(10);
    expect(rows[0]!.usecPerCall).toBe(10);
  });
});

describe("SLOWLOG redact + namespace filter", () => {
  test("filters to oke:kv:{ns}: and never returns values unless reveal", () => {
    const parsed = parseSlowlog(SLOWLOG);
    const filtered = filterSlowlogByPrefix(parsed, "oke:kv:cache:");
    expect(filtered).toHaveLength(2);
    expect(filtered.map((r) => r.command)).toEqual(["SET", "GET"]);
    const masked = redactSlowlogArgs(filtered, false);
    expect(JSON.stringify(masked)).not.toContain("a@oke.com");
    expect(JSON.stringify(masked)).not.toContain("oke:kv:cache:");
    expect(masked[0]!.args).toEqual([STORE_KV_SLOWLOG_ARG_REDACTED, STORE_KV_SLOWLOG_ARG_REDACTED]);
    const revealed = redactSlowlogArgs(filtered, true);
    expect(revealed[0]!.args[1]).toBe('{"email":"a@oke.com"}');
  });
});

describe("parseLatencyLatest", () => {
  test("reads Redis-shaped rows and nulls a short Dragonfly row", () => {
    expect(parseLatencyLatest([["command", 1_710_000_000, 12, 400], ["fork"]])).toEqual([
      { event: "command", latestUs: 12, allTimeUs: 400 },
      { event: "fork", latestUs: null, allTimeUs: null },
    ]);
    expect(parseLatencyLatest("ERR unknown command")).toEqual([]);
  });
});

describe("queryStoreKvStats", () => {
  test("memory driver is structured unsupported", async () => {
    const manifest: Manifest = {
      oke: "1.0",
      app: "kv-stats-test",
      flows: {},
      stores: { cache: { facet: "kv" } },
    };
    const runtime = await createManifestStoreRuntime(manifest);
    try {
      await queryStoreKvStats(runtime, "kv:cache");
      throw new Error("expected unsupported");
    } catch (err) {
      expect(err).toBeInstanceOf(StoreKvStatsError);
      expect((err as StoreKvStatsError).code).toBe(KV_STATS_UNSUPPORTED);
    }
    await runtime.close();
  });

  test("redis send fixture: KPIs, redaction, prefix filter, no hot-keys / MONITOR", async () => {
    const sent: string[] = [];
    const ns: KvNamespace = {
      driverId: "redis",
      get: async () => undefined,
      set: async () => {},
      delete: async () => false,
      list: async () => [],
      ttlMs: async () => null,
      eval: async <T = unknown>() => undefined as T,
      close: async () => {},
      send: async (command, args = []) => {
        sent.push([command, ...args].join(" "));
        if (command === "INFO" && args[0] === "stats") return REDIS_INFO;
        if (command === "INFO" && args[0] === "commandstats") return COMMANDSTATS_INFO;
        if (command === "SLOWLOG") return SLOWLOG;
        if (command === "LATENCY") return [["command", 1, 12, 400]];
        throw new Error(`unexpected ${command}`);
      },
    };
    const runtime = {
      async kvNamespace() {
        return ns;
      },
    } as unknown as StoreRuntime;

    const result = await queryStoreKvStats(runtime, "kv:cache");
    expect(result.engine).toBe("redis");
    expect(result.kpis.hitRate).toBeCloseTo(0.8);
    expect(result.commands).toHaveLength(2);
    expect(result.slowlog).toHaveLength(2);
    expect(JSON.stringify(result.slowlog)).not.toContain("a@oke.com");
    expect(result.masked).toBe(true);
    expect(result.limitation).toBe(STORE_KV_STATS_SERVER_WIDE_GAP);
    expect(result.slowlogLimitation).toBe(STORE_KV_STATS_SLOWLOG_ARGS_GAP);
    expect(result).not.toHaveProperty("hotKeys");
    expect(STORE_KV_STATS_COMMANDS).not.toContain("MONITOR");
    expect(sent.some((c) => c.startsWith("MONITOR"))).toBe(false);
    expect(sent.some((c) => c.startsWith("SLOWLOG"))).toBe(true);
  });
});
