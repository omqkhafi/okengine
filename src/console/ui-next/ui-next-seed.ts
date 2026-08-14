/**
 * Shared ui-next seed — same Manifest + WideEvents used by Playwright and
 * `bun run dev:console-next:seed` so manual browser exploration matches CI.
 *
 * Lives beside the Vite kernel plugin (root `tsc` include) — not under
 * `src/console/ui/**`, which root typecheck excludes as the legacy SPA tree.
 *
 * Seed story (keel): a featured github→create→notify chain, plus ~70
 * operational traces so Traces looks like a live Linear-shaped workspace
 * (50–100 band).
 */

import type { RunsStore, WideEvent } from "../../runs/types.ts";
import {
  createUiNextSeedRuns,
  UI_NEXT_SEED_OPERATION_COUNT,
  UI_NEXT_SEED_RUN_ID,
  UI_NEXT_SEED_TOTAL_COUNT,
} from "./ui-next-seed-runs.ts";
import { UI_NEXT_SEED_STORE_COUNTS } from "./ui-next-seed-store.ts";

export { UI_NEXT_SEEDED_MANIFEST } from "./ui-next-seed-manifest.ts";
export {
  createUiNextOperationRuns,
  createUiNextSeedRun,
  createUiNextSeedRuns,
  UI_NEXT_SEED_CYCLES_RUN_ID,
  UI_NEXT_SEED_DRAFTS_RUN_ID,
  UI_NEXT_SEED_FAIL_RUN_ID,
  UI_NEXT_SEED_FEATURED_COUNT,
  UI_NEXT_SEED_INGEST_RUN_ID,
  UI_NEXT_SEED_LIST_RUN_ID,
  UI_NEXT_SEED_NOTIFY_RUN_ID,
  UI_NEXT_SEED_OPERATION_COUNT,
  UI_NEXT_SEED_RUN_ID,
  UI_NEXT_SEED_TOTAL_COUNT,
  UI_NEXT_SEED_TRIAGE_RUN_ID,
} from "./ui-next-seed-runs.ts";
export { seedUiNextStoreData, UI_NEXT_SEED_STORE_COUNTS } from "./ui-next-seed-store.ts";

/**
 * Append the full ui-next seed WideEvent chain to a Console runs store.
 *
 * @param runs - Booted Console runs store
 * @param now - Clock ms
 */
export async function appendUiNextSeedRun(
  runs: Pick<RunsStore, "append">,
  now: number = Date.now(),
): Promise<readonly WideEvent[]> {
  const seeds = createUiNextSeedRuns(now);
  for (const seed of seeds) {
    await runs.append(seed);
  }
  return seeds;
}

/**
 * True when `OKE_CONSOLE_NEXT_SEEDED=1` (seeded `dev:console-next:seed` mode).
 */
export function isConsoleNextSeeded(): boolean {
  return process.env["OKE_CONSOLE_NEXT_SEEDED"] === "1";
}

/**
 * One-line description of what seeded mode preloads.
 */
export function uiNextSeededSummary(): string {
  return (
    `keel graph (all 8 elements) + ${UI_NEXT_SEED_TOTAL_COUNT} traces ` +
    `(featured chain + AI triage + clocks + ${UI_NEXT_SEED_OPERATION_COUNT} ops) + ` +
    `${UI_NEXT_SEED_STORE_COUNTS.sqlIssues} issues — ` +
    `click ${UI_NEXT_SEED_RUN_ID} to highlight the chain`
  );
}
