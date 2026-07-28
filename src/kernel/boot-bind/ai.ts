/**
 * Lazy AI binder — loaded only when AI is declared.
 */

import { mockAiDriver } from "../../drivers/ai-mock.ts";
import { createAiRuntime, type AiRuntime } from "../../elements/ai.ts";
import type { GateRuntime } from "../../elements/gate.ts";
import type { BootOptions } from "../boot.ts";

/**
 * Construct an AI runtime (mock default; shares gate for agents).
 *
 * @param options - Boot options
 * @param gate - Gate runtime for agent tool checks
 * @param now - Clock
 */
export function bindAi(
  options: BootOptions,
  gate: GateRuntime | undefined,
  now: () => number,
): AiRuntime {
  return createAiRuntime({
    ...(options.ai ?? {}),
    defaultDriver: options.ai?.defaultDriver ?? mockAiDriver,
    gates: options.ai?.gates ?? gate,
    now,
  });
}
