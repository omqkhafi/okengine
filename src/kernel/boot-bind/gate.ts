/**
 * Lazy gate binder — loaded only when Gate is declared (or required by AI).
 */

import { memoryDrivers } from "../../drivers/memory.ts";
import {
  createGateRuntime,
  type GateRuntime,
} from "../../elements/gate.ts";
import type { BootOptions } from "../boot.ts";

/**
 * Construct a Gate runtime backed by a memory kv namespace.
 *
 * @param options - Boot options
 * @param now - Clock
 */
export async function bindGate(
  options: BootOptions,
  now: () => number,
): Promise<GateRuntime> {
  const kvNs = await memoryDrivers.kv.open({ name: "oke:gates" });
  return createGateRuntime({
    gates: options.gates ?? [],
    kv: kvNs,
    now,
  });
}
