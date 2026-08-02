/**
 * Lazy gate binder — loaded only when Gate is declared (or required by AI).
 */

import { resolveDriverId, type ConfigEnv } from "../../config/index.ts";
import { memoryDrivers } from "../../drivers/memory.ts";
import { redisDriver } from "../../drivers/redis.ts";
import type { KvClientLike } from "../../drivers/types.ts";
import { createGateRuntime, type GateRuntime } from "../../elements/gate.ts";
import type { BootOptions } from "../boot.ts";

/** Namespace for gate rate-limit counters (never shares an app kv declaration). */
export const GATE_KV_NAMESPACE = "oke:gates";

/**
 * Resolve the KV backend for Gate rates — same facet as `drivers.store.kv`.
 *
 * @param options - Boot options
 * @param env - Active environment
 * @param docker - Docker mode
 */
export function resolveGateKvDriverId(
  options: BootOptions,
  env: ConfigEnv,
  docker = false,
): "memory" | "redis" {
  const fromEnv = process.env.OKE_KV_DRIVER?.trim();
  if (docker && fromEnv === "redis") return "redis";
  if (docker && fromEnv === "memory") return "memory";
  const resolved = resolveDriverId(options.config?.drivers?.store?.kv, env);
  if (resolved === "redis") return "redis";
  if (resolved === "memory") return "memory";
  return docker ? "redis" : "memory";
}

function kvUrlFor(docker: boolean): string | undefined {
  const url = process.env.REDIS_URL ?? process.env.OKE_STORE_KV_URL ?? undefined;
  if (!url) {
    if (docker) {
      throw new Error(
        "oke boot: gate redis kv needs REDIS_URL (did `oke dev -d` write docker/.env.docker?)",
      );
    }
    return undefined;
  }
  return url;
}

/**
 * Construct a Gate runtime backed by `drivers.store.kv` (namespace {@link GATE_KV_NAMESPACE}).
 *
 * @param options - Boot options
 * @param now - Clock
 * @param env - Active environment
 * @param docker - Docker mode
 */
export async function bindGate(
  options: BootOptions,
  now: () => number,
  env: ConfigEnv = "local",
  docker = false,
): Promise<GateRuntime> {
  const kvId = resolveGateKvDriverId(options, env, docker);
  const injected = options.clients?.kv as KvClientLike | undefined;

  let kvNs;
  if (kvId === "redis") {
    const url = injected ? undefined : kvUrlFor(docker);
    if (!injected && url === undefined) {
      // Local without REDIS_URL — soft-fallback to memory (same as missing redis for store would fail;
      // gate rates should not brick local apps that only declared policy gates).
      kvNs = await memoryDrivers.kv.open({ name: GATE_KV_NAMESPACE, nowMs: now });
    } else {
      kvNs = await redisDriver.open({
        name: GATE_KV_NAMESPACE,
        ...(url !== undefined ? { url } : {}),
        ...(injected !== undefined ? { client: injected } : {}),
        nowMs: now,
      });
    }
  } else {
    kvNs = await memoryDrivers.kv.open({ name: GATE_KV_NAMESPACE, nowMs: now });
  }

  return createGateRuntime({
    gates: options.gates ?? [],
    kv: kvNs,
    now,
  });
}
