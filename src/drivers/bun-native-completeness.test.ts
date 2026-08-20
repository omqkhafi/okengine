/**
 * Bun native-client completeness — gaps closed vs platform limitations.
 *
 * Checked against Bun 1.4 (runtime). Do not invent custom protocol clients
 * where Bun still lacks an API.
 */

import { describe, expect, test } from "bun:test";
import { createBunRedisClient } from "./redis.ts";
import { createBunSignalRedisClient, parseXreadgroupReply } from "./signal-redis.ts";

/** One row in the completeness report. */
export interface BunNativeGapRow {
  readonly surface: string;
  readonly capability: string;
  readonly status: "closed" | "bun_limitation";
  readonly note: string;
}

/**
 * Report table: which Bun client gaps closed vs genuine platform limits.
 *
 * Kept as a pure function so the gate test and human report share one source.
 */
export function bunNativeCompletenessReport(): readonly BunNativeGapRow[] {
  const redisProto = Bun.RedisClient.prototype as unknown as Record<string, unknown>;
  const hasTypedScan = typeof redisProto.scan === "function";
  const hasTypedPublish = typeof redisProto.publish === "function";
  const hasTypedSubscribe = typeof redisProto.subscribe === "function";
  const hasTypedSend = typeof redisProto.send === "function";
  const hasTypedXadd = typeof redisProto.xadd === "function";
  const hasTypedEval = typeof redisProto.eval === "function";

  return [
    {
      surface: "redis kv",
      capability: "SCAN (typed)",
      status: hasTypedScan ? "closed" : "bun_limitation",
      note: hasTypedScan
        ? "createBunRedisClient binds RedisClient.scan"
        : "Bun.redis.scan unavailable — would keep send(SCAN)",
    },
    {
      surface: "redis kv",
      capability: "EVAL (typed)",
      status: hasTypedEval ? "closed" : "bun_limitation",
      note: hasTypedEval
        ? "typed eval bound"
        : "Bun.RedisClient.eval unavailable — would keep send(EVAL)",
    },
    {
      surface: "redis signal",
      capability: "native Bun bind (publish/subscribe)",
      status: hasTypedPublish && hasTypedSubscribe ? "closed" : "bun_limitation",
      note:
        hasTypedPublish && hasTypedSubscribe
          ? "createBunSignalRedisClient uses typed publish/subscribe"
          : "pub/sub still unavailable on Bun.RedisClient",
    },
    {
      surface: "redis signal",
      capability: "XADD / XREADGROUP (typed)",
      status: hasTypedXadd ? "closed" : "bun_limitation",
      note: hasTypedXadd
        ? "typed stream helpers bound"
        : "Bun.RedisClient.xadd unavailable — Streams would keep send",
    },
    {
      surface: "redis signal",
      capability: "send escape hatch",
      status: hasTypedSend ? "closed" : "bun_limitation",
      note: hasTypedSend
        ? "send present — Streams/EVAL ride the native client"
        : "Bun.RedisClient.send missing",
    },
    {
      surface: "postgres signal",
      capability: "LISTEN / NOTIFY on Bun.SQL",
      status: "bun_limitation",
      note: "Bun.SQL has no listen/notify API — injectable PostgresSignalSql + fake remain",
    },
    {
      surface: "postgres sql",
      capability: "Bun.SQL.unsafe query/exec",
      status: "closed",
      note: "postgres driver already binds Bun.SQL; fake only for CI without a server",
    },
    {
      surface: "s3 files",
      capability: "Bun.S3Client file/list",
      status: "closed",
      note: "s3 driver binds write/arrayBuffer/exists/delete/list; presign/multipart unused by FilesBucket",
    },
  ];
}

describe("Bun native client completeness", () => {
  test("report table is exact and matches runtime Bun 1.4", () => {
    const rows = bunNativeCompletenessReport();
    expect(rows.length).toBe(8);

    const closed = rows.filter((r) => r.status === "closed").map((r) => r.capability);
    const limited = rows.filter((r) => r.status === "bun_limitation").map((r) => r.capability);

    expect(closed).toContain("SCAN (typed)");
    expect(closed).toContain("EVAL (typed)");
    expect(closed).toContain("native Bun bind (publish/subscribe)");
    expect(closed).toContain("XADD / XREADGROUP (typed)");
    expect(closed).toContain("send escape hatch");
    expect(closed).toContain("Bun.SQL.unsafe query/exec");
    expect(closed).toContain("Bun.S3Client file/list");

    expect(limited).toContain("LISTEN / NOTIFY on Bun.SQL");
  });

  test("createBunRedisClient exposes native scan", () => {
    const client = createBunRedisClient();
    expect(typeof client.scan).toBe("function");
  });

  test("createBunSignalRedisClient exposes stream + pub/sub surface", () => {
    const client = createBunSignalRedisClient();
    expect(typeof client.xadd).toBe("function");
    expect(typeof client.publish).toBe("function");
    expect(typeof client.subscribe).toBe("function");
  });

  test("parseXreadgroupReply reads nested Redis arrays", () => {
    const parsed = parseXreadgroupReply([
      [
        "oke:signal:order",
        [
          ["1-0", ["payload", '{"a":1}', "signal", "order"]],
          ["1-1", ["payload", "{}", "signal", "order"]],
        ],
      ],
    ]);
    expect(parsed).toEqual([
      { id: "1-0", fields: { payload: '{"a":1}', signal: "order" } },
      { id: "1-1", fields: { payload: "{}", signal: "order" } },
    ]);
    expect(parseXreadgroupReply(null)).toEqual([]);
  });
});
