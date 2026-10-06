/**
 * Lazy signal binder — loaded only when Signal is declared.
 */

import { resolveDriverId, type ConfigEnv } from "../../config/index.ts";
import { SIGNAL_DEFAULTS } from "../../config/driver-defaults.ts";
import {
  sharedPostgresClient,
  toPostgresParams,
  withPinnedPostgres,
} from "../../drivers/postgres.ts";
import type { PostgresClientLike } from "../../drivers/postgres.ts";
import { memorySignalDriver } from "../../drivers/signal-memory.ts";
import type { PostgresSignalSql } from "../../drivers/signal-postgres.ts";
import { postgresSignalDriver } from "../../drivers/signal-postgres.ts";
import { createBunSignalRedisClient, redisSignalDriver } from "../../drivers/signal-redis.ts";
import type { SignalRedisClientLike } from "../../drivers/signal-types.ts";
import { createSignalRuntime, type SignalRuntime } from "../../elements/signal.ts";
import { resolveInstanceId } from "../instance-id.ts";
import type { BootOptions } from "../boot.ts";

/**
 * Resolve `drivers.signal` for the active env (default `memory`).
 *
 * @param options - Boot options
 * @param env - Active environment
 */
export function resolveSignalDriverId(options: BootOptions, env: ConfigEnv): string {
  // Defaults cover every ConfigEnv key, so this is never undefined.
  return resolveDriverId(options.config?.drivers?.signal, env, SIGNAL_DEFAULTS)!;
}

function redisUrlFor(docker: boolean): string | undefined {
  const url = process.env.REDIS_URL ?? process.env.OKE_STORE_KV_URL ?? undefined;
  if (!url && docker) {
    throw new Error(
      "oke boot: signal redis driver needs REDIS_URL (did `oke dev -d` write .env.local?)",
    );
  }
  return url;
}

/**
 * Wrap a Bun.SQL client as the signal driver's query surface.
 * `listen` is omitted — Bun.SQL has no LISTEN/NOTIFY. Boot polls `drain`.
 *
 * @param client - Shared postgres pool
 */
function asSignalSql(client: PostgresClientLike): PostgresSignalSql {
  return {
    async query(sql, params = []) {
      const result = await client.unsafe(toPostgresParams(sql, params), [...params]);
      if (Array.isArray(result)) return result as Record<string, unknown>[];
      return Array.from(result as ArrayLike<Record<string, unknown>>);
    },
    async exec(sql, params = []) {
      const result = await client.unsafe(toPostgresParams(sql, params), [...params]);
      if (
        result &&
        typeof result === "object" &&
        "changes" in result &&
        typeof result.changes === "number"
      ) {
        return { changes: result.changes };
      }
      if (Array.isArray(result)) return { changes: result.length };
      return { changes: 0 };
    },
    begin: (fn) => withPinnedPostgres(client, (tx) => fn(asSignalSql(tx))),
    async close() {
      /* Shared pool — boot owns the connection. */
    },
  };
}

/**
 * Construct a Signal runtime, register decls / binding names, start the bus.
 *
 * Supported ids: `memory` · `redis` · `postgres`. `nats` fails loud until a
 * native client can be constructed (never silently bind memory).
 *
 * @param options - Boot options
 * @param env - Active environment
 * @param now - Clock
 * @param docker - Docker mode
 */
export async function bindSignal(
  options: BootOptions,
  env: ConfigEnv,
  now: () => number,
  docker = false,
): Promise<SignalRuntime> {
  const signalId = resolveSignalDriverId(options, env);
  const injectedRedis = options.clients?.signalRedis as SignalRedisClientLike | undefined;

  let signal: SignalRuntime;
  switch (signalId) {
    case "memory":
      signal = createSignalRuntime({
        driver: memorySignalDriver,
        now,
      });
      break;
    case "redis": {
      const redis = injectedRedis ?? createBunSignalRedisClient(redisUrlFor(docker));
      signal = createSignalRuntime({
        driver: redisSignalDriver,
        now,
        redis,
        compete: true,
        consumerId: resolveInstanceId(options.instanceId),
      });
      break;
    }
    case "postgres": {
      const injected = options.clients?.signalSql;
      const url = process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL ?? undefined;
      if (!injected && !url) {
        throw new Error(
          env === "dev"
            ? 'oke boot: signal driver "postgres" needs DATABASE_URL (did `oke dev` write .env.local?)'
            : 'oke boot: signal driver "postgres" needs DATABASE_URL',
        );
      }
      signal = createSignalRuntime({
        driver: postgresSignalDriver,
        now,
        sql: injected ?? asSignalSql(sharedPostgresClient(url)),
        pollMs: injected ? undefined : 1_000,
      });
      break;
    }
    case "nats":
      throw new Error(
        'oke boot: signal driver "nats" has no production client bind yet — ' +
          'use "redis" or "memory", or inject elements.signal.',
      );
    default:
      throw new Error(
        `oke boot: unknown signal driver "${signalId}" (expected memory · redis · postgres · nats)`,
      );
  }

  for (const decl of options.signals ?? []) {
    signal.register(decl);
  }
  for (const b of options.bindings ?? []) {
    if (b.trigger.kind === "signal") {
      if (!signal.declarations.has(b.trigger.name)) {
        signal.register({
          name: b.trigger.name,
          delivery: "once",
          retries: 3,
          deadLetter: true,
          optional: true,
        });
      }
    }
  }
  const bus = await signal.start();

  if (options.onSignal) {
    const handler = options.onSignal;
    const seen = new Set<string>();
    for (const b of options.bindings ?? []) {
      if (b.trigger.kind !== "signal") continue;
      const name = b.trigger.name;
      if (seen.has(name)) continue;
      seen.add(name);
      await bus.subscribe(name, `oke:${name}`, async (msg) => {
        await handler(name, msg.payload, {
          ...(msg.parentRunId !== undefined ? { parentRunId: msg.parentRunId } : {}),
          messageId: msg.id,
        });
      });
    }
  }

  return signal;
}
