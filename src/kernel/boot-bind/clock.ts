/**
 * Lazy clock binder — loaded only when Clock is declared.
 */

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  clock as declareClock,
  createClockRuntime,
  createFileCronStore,
  createMemoryCronStore,
  createTestClockRuntime,
  type ClockDecl,
  type ClockRuntime,
} from "../../elements/clock.ts";
import { createPostgresCronStore } from "../../drivers/clock-postgres.ts";
import { resolveDriverId, type ConfigEnv } from "../../config/index.ts";
import { CLOCK_DEFAULTS } from "../../config/driver-defaults.ts";
import type { BootOptions } from "../boot.ts";

/** Result of binding a clock runtime. */
export interface BindClockResult {
  readonly clock: ClockRuntime;
  readonly clockDecls: ReadonlyMap<string, ClockDecl>;
}

/** Default on-disk cron store path (multi-process leader election). */
export const DEFAULT_FILE_CRON_PATH = ".oke/crons.json";

/**
 * Resolve `drivers.clock` for the active env.
 *
 * @param options - Boot options
 * @param env - Active environment
 */
export function resolveClockDriverId(options: BootOptions, env: ConfigEnv): string {
  // Defaults cover every ConfigEnv key, so this is never undefined.
  return resolveDriverId(options.config?.drivers?.clock, env, CLOCK_DEFAULTS)!;
}

/**
 * Construct / adopt a Clock runtime, register decls, reconcile.
 *
 * Supported ids: `frozen` · `memory` · `file` · `postgres`.
 *
 * @param options - Boot options
 * @param env - Active environment
 * @param now - Clock
 * @param prebuilt - Optional injected runtime
 */
export async function bindClock(
  options: BootOptions,
  env: ConfigEnv,
  now: () => number,
  prebuilt?: ClockRuntime,
): Promise<BindClockResult> {
  const clockDriver = resolveClockDriverId(options, env);

  let clock: ClockRuntime;
  if (prebuilt) {
    clock = prebuilt;
  } else if (clockDriver === "frozen" || env === "test") {
    clock = createTestClockRuntime(now(), {
      instanceId: options.instanceId,
      ...(options.tenantIds ? { tenantIds: options.tenantIds } : {}),
    });
  } else if (clockDriver === "memory") {
    clock = createClockRuntime({
      instanceId: options.instanceId,
      now,
      store: createMemoryCronStore(),
      ...(options.tenantIds ? { tenantIds: options.tenantIds } : {}),
    });
  } else if (clockDriver === "file") {
    const path = resolve(process.cwd(), DEFAULT_FILE_CRON_PATH);
    mkdirSync(dirname(path), { recursive: true });
    clock = createClockRuntime({
      instanceId: options.instanceId,
      now,
      store: createFileCronStore(path),
      ...(options.tenantIds ? { tenantIds: options.tenantIds } : {}),
    });
  } else if (clockDriver === "postgres") {
    const url = process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL ?? undefined;
    if (!url) {
      throw new Error(
        env === "dev"
          ? 'oke boot: clock driver "postgres" needs DATABASE_URL (did `oke dev` write .env.local?)'
          : 'oke boot: clock driver "postgres" needs DATABASE_URL',
      );
    }
    const store = await createPostgresCronStore({ url });
    clock = createClockRuntime({
      instanceId: options.instanceId,
      now,
      store,
      ...(options.tenantIds ? { tenantIds: options.tenantIds } : {}),
    });
  } else {
    throw new Error(
      `oke boot: unknown clock driver "${clockDriver}" (expected memory · file · postgres · frozen)`,
    );
  }

  const clockDecls = new Map<string, ClockDecl>();
  for (const c of options.clocks ?? []) {
    clockDecls.set(c.name, c);
  }
  const coveredEvery = new Set([...clockDecls.values()].flatMap((c) => (c.every ? [c.every] : [])));
  for (const b of options.bindings ?? []) {
    if (b.trigger.kind !== "every") continue;
    if (clockDecls.has(b.trigger.interval) || coveredEvery.has(b.trigger.interval)) continue;
    clockDecls.set(
      b.trigger.interval,
      declareClock(b.trigger.interval, { every: b.trigger.interval }),
    );
    coveredEvery.add(b.trigger.interval);
  }
  for (const decl of clockDecls.values()) {
    clock.register(decl);
  }
  await clock.reconcile();

  if (options.onCronFire) {
    const fire = options.onCronFire;
    for (const name of clockDecls.keys()) {
      clock.onCron(name, async (row) => {
        await fire(row.name);
      });
    }
  }

  clock.startWakes();

  return { clock, clockDecls };
}
