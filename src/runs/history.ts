/**
 * Read persisted WideEvents from a `files` localRoot (Console historical list).
 */

import { access } from "node:fs/promises";
import { createRunsRuntime } from "./runtime.ts";
import type { WideEvent } from "./types.ts";

/**
 * Load WideEvents from a Parquet `files` root. Empty / missing dir → `[]`.
 *
 * @param localRoot - Absolute `.oke/runs` path
 */
export async function readPersistedRuns(localRoot: string): Promise<WideEvent[]> {
  try {
    await access(localRoot);
  } catch {
    return [];
  }
  const runs = createRunsRuntime({
    driver: "files",
    localRoot,
    retention: { keep: "forever" },
  });
  await runs.open();
  try {
    return await runs.all();
  } finally {
    await runs.close();
  }
}

/**
 * Union live (in-process) events with disk. Live wins on the same id.
 *
 * @param live - Console memory / ingest copy
 * @param localRoot - Host `files` root
 */
export async function mergeLiveAndPersistedRuns(
  live: readonly WideEvent[],
  localRoot: string,
): Promise<WideEvent[]> {
  const persisted = await readPersistedRuns(localRoot);
  const byId = new Map<string, WideEvent>();
  for (const event of persisted) byId.set(event.id, event);
  for (const event of live) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => b.startedAt - a.startedAt);
}
