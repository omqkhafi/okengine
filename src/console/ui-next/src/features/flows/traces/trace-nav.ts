/**
 * Identity lines and list neighbors for the trace detail header.
 */

import type { RunRow } from "@/client.ts";

/** One copyable identifier shown under the trace title. */
export type TraceIdentityLine = {
  readonly key: "run" | "parent";
  readonly label: string;
  readonly value: string;
};

/** Where the open trace sits in the list the sheet can step through. */
export type TraceNav = {
  /** Index in `runs`, or `-1` when the open trace is not in the list. */
  readonly index: number;
  readonly total: number;
  /** Row above the open trace (newer, when the list is newest-first). */
  readonly previousId: string | null;
  /** Row below the open trace. */
  readonly nextId: string | null;
};

/**
 * Run id, plus parent id when the trace was called from another run.
 *
 * @param run - Open trace
 */
export function traceIdentityLines(
  run: Pick<RunRow, "id" | "parentId">,
): readonly TraceIdentityLine[] {
  const lines: TraceIdentityLine[] = [{ key: "run", label: "Run", value: run.id }];
  if (run.parentId) lines.push({ key: "parent", label: "Parent", value: run.parentId });
  return lines;
}

/**
 * Previous and next traces relative to the open one, in list order.
 *
 * @param runs - Ordered traces (Traces pane: newest first)
 * @param currentId - Open trace id
 */
export function traceNav(runs: readonly { readonly id: string }[], currentId: string): TraceNav {
  const index = runs.findIndex((run) => run.id === currentId);
  if (index < 0) {
    return { index: -1, total: runs.length, previousId: null, nextId: null };
  }
  const previous = index > 0 ? runs[index - 1] : undefined;
  const next = index < runs.length - 1 ? runs[index + 1] : undefined;
  return {
    index,
    total: runs.length,
    previousId: previous?.id ?? null,
    nextId: next?.id ?? null,
  };
}
