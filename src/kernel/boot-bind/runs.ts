/**
 * Lazy runs binder — loaded only when runs are requested.
 */

import {
  createRunsRuntime,
  memoryRunsDriver,
  type CreateRunsRuntimeOptions,
  type RunsRuntime,
} from "../../runs/index.ts";

/**
 * Construct and open a runs runtime.
 *
 * @param options - Create options (when not already a runtime)
 */
export async function bindRuns(
  options?: CreateRunsRuntimeOptions,
): Promise<RunsRuntime> {
  const runs = createRunsRuntime({
    driver: options?.driver ?? memoryRunsDriver,
    ...(options ?? {}),
  });
  if (!runs.store) {
    await runs.open();
  }
  return runs;
}
