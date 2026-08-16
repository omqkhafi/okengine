/**
 * Lazy instance-registry binder — loaded only when the fleet is active.
 */

import type { ConfigEnv } from "../../config/index.ts";
import { createPostgresInstanceStore } from "../../drivers/instances-postgres.ts";
import { createInstanceRuntime, type InstanceRuntime, type InstanceStore } from "../instances.ts";
import type { BootOptions } from "../boot.ts";

/** Result of binding the fleet registry. */
export interface BindInstancesResult {
  readonly instances: InstanceRuntime;
}

/**
 * Shared SQL URL used by Clock / Journal / the fleet registry.
 *
 * @returns DATABASE_URL or OKE_STORE_SQL_URL
 */
export function sharedSqlUrl(): string | undefined {
  return process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL ?? undefined;
}

/**
 * Construct a heartbeat runtime. Supported stores: injected · postgres.
 *
 * @param options - Boot options
 * @param env - Active environment
 * @param instanceId - Unified process id
 * @param now - Clock
 */
export async function bindInstances(
  options: BootOptions,
  env: ConfigEnv,
  instanceId: string,
  now: () => number,
): Promise<BindInstancesResult | undefined> {
  const prebuilt = options.elements?.instances;
  if (prebuilt) return { instances: prebuilt };

  let store: InstanceStore | undefined = options.instanceStore;
  if (!store) {
    const url = sharedSqlUrl();
    if (!url || env === "test") return undefined;
    store = await createPostgresInstanceStore({ url });
  }

  const instances = createInstanceRuntime({
    instanceId,
    store,
    env,
    now,
    heartbeatMs: options.instanceHeartbeatMs,
    leaseMs: options.instanceLeaseMs,
  });
  await instances.heartbeat();
  return { instances };
}
