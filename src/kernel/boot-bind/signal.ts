/**
 * Lazy signal binder — loaded only when Signal is declared.
 */

import { resolveDriverId, type ConfigEnv } from "../../config/index.ts";
import { memorySignalDriver } from "../../drivers/signal-memory.ts";
import { createBunSignalRedisClient, redisSignalDriver } from "../../drivers/signal-redis.ts";
import type { SignalRedisClientLike } from "../../drivers/signal-types.ts";
import { createSignalRuntime, type SignalRuntime } from "../../elements/signal.ts";
import type { BootOptions } from "../boot.ts";

/**
 * Resolve `drivers.signal` for the active env (default `memory`).
 *
 * @param options - Boot options
 * @param env - Active environment
 */
export function resolveSignalDriverId(options: BootOptions, env: ConfigEnv): string {
  return resolveDriverId(options.config?.drivers?.signal, env) ?? "memory";
}

function redisUrlFor(docker: boolean): string | undefined {
  const url = process.env.REDIS_URL ?? process.env.OKE_STORE_KV_URL ?? undefined;
  if (!url && docker) {
    throw new Error(
      "oke boot: signal redis driver needs REDIS_URL (did `oke dev -d` write docker/.env.docker?)",
    );
  }
  return url;
}

/**
 * Construct a Signal runtime, register decls / binding names, start the bus.
 *
 * Supported ids: `memory` · `redis`. `postgres` / `nats` fail loud until a real
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
      });
      break;
    }
    case "postgres":
      throw new Error(
        'oke boot: signal driver "postgres" needs a LISTEN/NOTIFY-capable SQL client — ' +
          'not available via Bun.SQL yet. Use "redis" or "memory", or inject elements.signal.',
      );
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
        await handler(name, msg.payload);
      });
    }
  }

  return signal;
}
