/**
 * Lazy signal binder — loaded only when Signal is declared.
 */

import { memorySignalDriver } from "../../drivers/signal-memory.ts";
import { createSignalRuntime, type SignalRuntime } from "../../elements/signal.ts";
import { resolveDriverId, type ConfigEnv } from "../../config/index.ts";
import type { BootOptions } from "../boot.ts";

/**
 * Construct a Signal runtime, register decls / binding names, start the bus.
 *
 * @param options - Boot options
 * @param env - Active environment
 * @param now - Clock
 */
export async function bindSignal(
  options: BootOptions,
  env: ConfigEnv,
  now: () => number,
): Promise<SignalRuntime> {
  const signalId = resolveDriverId(options.config?.drivers?.signal, env) ?? "memory";
  void signalId;
  const signal = createSignalRuntime({
    driver: memorySignalDriver,
    now,
  });
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
