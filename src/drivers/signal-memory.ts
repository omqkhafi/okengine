/**
 * `memory` signal driver — in-process bus for dev / test.
 */

import { createSignalEngine } from "./signal-engine.ts";
import type { SignalDriver, SignalOpenOptions } from "./signal-types.ts";

/**
 * Open an in-memory signal bus.
 *
 * @param options - Declarations / durable path / clock
 */
export async function openMemorySignal(options: SignalOpenOptions) {
  return createSignalEngine("memory", options);
}

/** Protocol-named memory signal driver. */
export const memorySignalDriver: SignalDriver = {
  id: "memory",
  open: openMemorySignal,
};
