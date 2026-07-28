/**
 * Lazy clock binder — loaded only when Clock is declared.
 */

import {
  clock as declareClock,
  createClockRuntime,
  createTestClockRuntime,
  type ClockDecl,
  type ClockRuntime,
} from "../../elements/clock.ts";
import { resolveDriverId, type ConfigEnv } from "../../config/index.ts";
import type { BootOptions } from "../boot.ts";

/** Result of binding a clock runtime. */
export interface BindClockResult {
  readonly clock: ClockRuntime;
  readonly clockDecls: ReadonlyMap<string, ClockDecl>;
}

/**
 * Construct / adopt a Clock runtime, register decls, reconcile.
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
  const clockDriver =
    resolveDriverId(options.config?.drivers?.clock, env) ?? (env === "test" ? "frozen" : "memory");
  const clock =
    prebuilt ??
    (clockDriver === "frozen" || env === "test"
      ? createTestClockRuntime(now(), { instanceId: options.instanceId })
      : createClockRuntime({ instanceId: options.instanceId, now }));

  const clockDecls = new Map<string, ClockDecl>();
  for (const c of options.clocks ?? []) {
    clockDecls.set(c.name, c);
  }
  for (const b of options.bindings ?? []) {
    if (b.trigger.kind === "every" && !clockDecls.has(b.trigger.interval)) {
      clockDecls.set(
        b.trigger.interval,
        declareClock(b.trigger.interval, { every: b.trigger.interval }),
      );
    }
  }
  for (const decl of clockDecls.values()) {
    clock.register(decl);
  }
  await clock.reconcile();

  if (options.onCronFire) {
    const fire = options.onCronFire;
    for (const name of clockDecls.keys()) {
      clock.onCron(name, async () => {
        await fire(name);
      });
    }
  }

  return { clock, clockDecls };
}
