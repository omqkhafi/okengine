/**
 * Shared ui-next seed — same Manifest + WideEvent used by Playwright and
 * `bun run dev:console-next:seeded` so manual browser exploration matches CI.
 *
 * Lives beside the Vite kernel plugin (root `tsc` include) — not under
 * `src/console/ui/**`, which root typecheck excludes as the legacy SPA tree.
 */

import type { RunsStore, WideEvent } from "../../runs/types.ts";
import { FLOWS_TEST_MANIFEST } from "../ui/flows/fixture.ts";

/** Stable run id for the seeded `bookings.create` WideEvent. */
export const UI_NEXT_SEED_RUN_ID = "pw-run-bookings-create";

/** Manifest seeded into the Console for ui-next Flows exploration. */
export const UI_NEXT_SEEDED_MANIFEST = FLOWS_TEST_MANIFEST;

/**
 * Build the seeded WideEvent (one completed `bookings.create` run).
 *
 * @param now - Clock ms (defaults to `Date.now()`)
 */
export function createUiNextSeedRun(now: number = Date.now()): WideEvent {
  return {
    id: UI_NEXT_SEED_RUN_ID,
    flow: "bookings.create",
    unit: "bookings",
    trigger: "http",
    plane: "user",
    gates: [],
    cache: "none",
    effects: [],
    logs: [],
    durationMs: 12,
    startedAt: now - 12,
    endedAt: now,
    dimensions: { flow: "bookings.create" },
  };
}

/**
 * Append the ui-next seed WideEvent to a Console runs store.
 *
 * @param runs - Booted Console runs store
 * @param now - Clock ms
 */
export async function appendUiNextSeedRun(
  runs: Pick<RunsStore, "append">,
  now: number = Date.now(),
): Promise<WideEvent> {
  const seed = createUiNextSeedRun(now);
  await runs.append(seed);
  return seed;
}

/**
 * True when `OKE_CONSOLE_NEXT_SEEDED=1` (seeded `dev:console-next` mode).
 */
export function isConsoleNextSeeded(): boolean {
  return process.env["OKE_CONSOLE_NEXT_SEEDED"] === "1";
}

/**
 * One-line description of what seeded mode preloads.
 */
export function uiNextSeededSummary(): string {
  return (
    "FLOWS_TEST_MANIFEST graph (bookings / fulfillment / payments) + " +
    `one ${UI_NEXT_SEED_RUN_ID} trace — click the Traces row to highlight bookings.create`
  );
}
