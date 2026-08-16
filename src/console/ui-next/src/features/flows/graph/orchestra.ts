/**
 * Overview orchestra — pick a real request from the traces ledger and
 * replay it as a new note. The orbit lights that path; the list grows.
 * Does not invoke host flows.
 *
 * Seeded Console only (`dev:console:seed`). Live `oke dev` traces stay
 * operation-based — Clock, HTTP, Call API — never minted notes.
 */

import type { RunRow } from "@/client.ts";

/** Run ids minted by the orchestra. */
export const ORCHESTRA_ID_PREFIX = "orch-";

/**
 * Whether a run was minted by the orchestra (not a host / seed row).
 *
 * @param id - Run id
 */
export function isOrchestraRunId(id: string): boolean {
  return id.startsWith(ORCHESTRA_ID_PREFIX);
}

/**
 * Whether Overview may mint random notes into Traces.
 *
 * @param seeded - `OKE_CONSOLE_SEEDED=1` Vite serve
 * @param ready - Manifest loaded and the ledger has at least one real run
 */
export function shouldRunOrchestra(seeded: boolean, ready: boolean): boolean {
  return seeded && ready;
}

/**
 * Pick a repertoire row — host/seed runs only, so notes stay diverse.
 *
 * @param runs - Current traces buffer
 * @param random - Unit interval RNG
 */
export function pickOrchestraTemplate(
  runs: readonly RunRow[],
  random: () => number = Math.random,
): RunRow | null {
  const pool = runs.filter((run) => !isOrchestraRunId(run.id) && run.flow.length > 0);
  if (pool.length === 0) return null;
  return pool[Math.floor(random() * pool.length)] ?? null;
}

/**
 * Mint a new run from a template, stamped at `now`.
 *
 * @param template - Repertoire row
 * @param now - Clock ms
 * @param seq - Monotonic note index
 */
export function materializeOrchestraRun(template: RunRow, now: number, seq: number): RunRow {
  const shift = now - template.startedAt;
  const slug = template.flow.replaceAll(".", "-");
  return {
    ...template,
    id: `${ORCHESTRA_ID_PREFIX}${seq}-${slug}`,
    parentId: null,
    startedAt: now,
    endedAt: now + template.durationMs,
    effects: template.effects.map((effect) => ({
      ...effect,
      timestamp: effect.timestamp + shift,
    })),
    logs: template.logs.map((log) => ({
      ...log,
      at: log.at + shift,
    })),
  };
}

/**
 * Gap before the next note (ms).
 *
 * @param random - Unit interval RNG
 */
export function nextOrchestraDelayMs(random: () => number = Math.random): number {
  return 1800 + Math.floor(random() * 1600);
}

/** How long a note stays lit on the orbit. */
export const ORCHESTRA_HOLD_MS = 1400;
