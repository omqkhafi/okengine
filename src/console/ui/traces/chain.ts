/**
 * Causal chain across asynchronous boundaries (console §9.3).
 *
 * When `create` emits `order-placed` and another flow consumes it, declared
 * parentId joins them: parent above, current, children below.
 */

import type { TraceSpan } from "./types.ts";

/** Causal chain focused on one span. */
export interface CausalChain {
  /** Ancestors from root to immediate parent. */
  readonly parents: readonly TraceSpan[];
  /** Focused span. */
  readonly current: TraceSpan;
  /** Direct children. */
  readonly children: readonly TraceSpan[];
  /** Every span in the connected component (for waterfall / replay). */
  readonly connected: readonly TraceSpan[];
}

/** Root-grouped forest entry for the list. */
export interface TraceRoot {
  /** Root span id. */
  readonly rootId: string;
  /** Root span. */
  readonly root: TraceSpan;
  /** All spans in this trace (root + descendants), start-time order. */
  readonly spans: readonly TraceSpan[];
}

/**
 * Index spans by id and parent.
 *
 * @param spans - All known spans
 */
export function indexSpans(spans: readonly TraceSpan[]): {
  readonly byId: ReadonlyMap<string, TraceSpan>;
  readonly childrenOf: ReadonlyMap<string, readonly TraceSpan[]>;
} {
  const byId = new Map<string, TraceSpan>();
  const childrenOf = new Map<string, TraceSpan[]>();
  for (const s of spans) {
    byId.set(s.id, s);
  }
  for (const s of spans) {
    if (!s.parentId) continue;
    const list = childrenOf.get(s.parentId) ?? [];
    list.push(s);
    childrenOf.set(s.parentId, list);
  }
  for (const [, list] of childrenOf) {
    list.sort((a, b) => a.startedAt - b.startedAt);
  }
  return { byId, childrenOf };
}

/**
 * Build the causal chain for a focused span.
 *
 * @param spans - All known spans
 * @param currentId - Focused span id
 */
export function buildCausalChain(
  spans: readonly TraceSpan[],
  currentId: string,
): CausalChain | null {
  const { byId, childrenOf } = indexSpans(spans);
  const current = byId.get(currentId);
  if (!current) return null;

  const parents: TraceSpan[] = [];
  let cursor: TraceSpan | undefined = current;
  const seen = new Set<string>();
  while (cursor?.parentId) {
    if (seen.has(cursor.parentId)) break;
    seen.add(cursor.parentId);
    const parent = byId.get(cursor.parentId);
    if (!parent) break;
    parents.unshift(parent);
    cursor = parent;
  }

  const children = childrenOf.get(current.id) ?? [];
  const root = parents[0] ?? current;
  const connected = collectDescendants(root.id, byId, childrenOf);
  return { parents, current, children, connected };
}

/**
 * Group spans into root traces for the list.
 *
 * @param spans - All known spans
 */
export function groupTraceRoots(spans: readonly TraceSpan[]): TraceRoot[] {
  const { byId, childrenOf } = indexSpans(spans);
  const roots = spans.filter(
    (s) => !s.parentId || !byId.has(s.parentId),
  );
  roots.sort((a, b) => b.startedAt - a.startedAt);
  return roots.map((root) => ({
    rootId: root.id,
    root,
    spans: collectDescendants(root.id, byId, childrenOf),
  }));
}

/**
 * Initial focus when opening a trace: the failing span if any, else the root.
 *
 * @param spans - Spans in the connected component
 * @param preferredId - Optional URL-selected span
 */
export function initialFocusSpanId(
  spans: readonly TraceSpan[],
  preferredId?: string,
): string | undefined {
  if (preferredId && spans.some((s) => s.id === preferredId)) {
    return preferredId;
  }
  const failed = spans.find((s) => s.errorCode != null && s.errorCode !== "");
  if (failed) return failed.id;
  const root = spans.find((s) => !s.parentId || !spans.some((p) => p.id === s.parentId));
  return root?.id ?? spans[0]?.id;
}

function collectDescendants(
  rootId: string,
  byId: ReadonlyMap<string, TraceSpan>,
  childrenOf: ReadonlyMap<string, readonly TraceSpan[]>,
): TraceSpan[] {
  const out: TraceSpan[] = [];
  const walk = (id: string): void => {
    const span = byId.get(id);
    if (!span) return;
    out.push(span);
    for (const child of childrenOf.get(id) ?? []) {
      walk(child.id);
    }
  };
  walk(rootId);
  out.sort((a, b) => a.startedAt - b.startedAt);
  return out;
}
