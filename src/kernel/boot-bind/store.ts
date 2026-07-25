/**
 * Lazy store binder — loaded only when Store is declared.
 */

import { memoryDrivers } from "../../drivers/memory.ts";
import {
  createStoreRuntime,
  type StoreRuntime,
} from "../../elements/store.ts";
import {
  resolveDriverId,
  type ConfigEnv,
} from "../../config/index.ts";
import type { BootOptions } from "../boot.ts"; // type-only — no cycle at runtime

/**
 * Construct a Store runtime and register facet declarations.
 *
 * @param options - Boot options
 * @param env - Active environment
 * @param now - Clock
 */
export function bindStore(
  options: BootOptions,
  env: ConfigEnv,
  now: () => number,
): StoreRuntime {
  const sqlId =
    resolveDriverId(options.config?.drivers?.store?.sql, env) ?? "memory";
  const kvId =
    resolveDriverId(options.config?.drivers?.store?.kv, env) ?? "memory";
  void sqlId;
  void kvId;
  const store = createStoreRuntime({
    drivers: {
      sql: memoryDrivers.sql,
      kv: memoryDrivers.kv,
      files: memoryDrivers.files,
      index: memoryDrivers.index,
    },
    now,
  });
  for (const decl of options.stores ?? []) {
    store.register?.(decl);
  }
  return store;
}
