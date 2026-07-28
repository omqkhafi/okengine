/**
 * Dry-run effect stubbing + write isolation (console §9.1 · §9.3 · §9.4).
 *
 * - Irreversible effects (`send` / `ask`) are intercepted and recorded as
 *   "would have fired" — never contact a real channel or model.
 * - Store writes run against real data for an honest pass/fail verdict, then
 *   are always rolled back (snapshot / restore) when the dry-run scope exits.
 * - Drivers that cannot isolate writes throw {@link DryRunWriteIsolationError};
 *   the operator plane refuses rather than silently risk a double-write.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** One intercepted irreversible effect during a dry run. */
export interface DryRunWouldHaveFired {
  /** Irreversible kind. */
  readonly kind: "send" | "ask";
  /** Template / prompt name. */
  readonly resource: string;
  /** Optional correlating message id (signal dry-run). */
  readonly messageId?: string;
}

/** Active dry-run bag. */
export interface DryRunContext {
  /** Intercepted send/ask calls in order. */
  readonly wouldHaveFired: DryRunWouldHaveFired[];
  /** Optional message id stamped onto subsequent intercepts. */
  messageId?: string;
  /**
   * Deep-cloned table snapshots taken before the first touch of each stub store.
   * Restored in `finally` so dry-run writes never persist.
   */
  readonly storeSnapshots: Map<string, Map<string, unknown>>;
  /** Live stub-store Maps to restore from {@link storeSnapshots}. */
  readonly storeRefs: Map<string, Map<string, unknown>>;
}

/**
 * Thrown when a dry-run write cannot be transactionally isolated.
 *
 * The Console / signal bus must refuse the dry-run for that signal rather
 * than risk a committed double-write.
 */
export class DryRunWriteIsolationError extends Error {
  /** Stable machine code. */
  readonly code = "dry_run_write_isolation" as const;

  /**
   * @param reason - Human-readable refusal reason
   */
  constructor(reason: string) {
    super(reason);
    this.name = "DryRunWriteIsolationError";
  }
}

const storage = new AsyncLocalStorage<DryRunContext>();

/**
 * Whether the current async chain is inside a dry-run scope.
 */
export function isDryRun(): boolean {
  return storage.getStore() !== undefined;
}

/**
 * Active dry-run context, or `undefined` outside a dry-run.
 */
export function getDryRunContext(): DryRunContext | undefined {
  return storage.getStore();
}

/**
 * Snapshot of intercepted irreversible effects for the current dry-run.
 */
export function dryRunWouldHaveFired(): readonly DryRunWouldHaveFired[] {
  return storage.getStore()?.wouldHaveFired ?? [];
}

/**
 * Stamp the active dry-run with a signal message id (for correlating stubs).
 *
 * @param messageId - Dead-letter / message id
 */
export function setDryRunMessageId(messageId: string): void {
  const ctx = storage.getStore();
  if (ctx) ctx.messageId = messageId;
}

/**
 * Record that a send/ask would have fired. No-op outside dry-run.
 *
 * @param kind - Irreversible kind
 * @param resource - Template / prompt name
 */
export function recordWouldHaveFired(kind: "send" | "ask", resource: string): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  ctx.wouldHaveFired.push({
    kind,
    resource,
    ...(ctx.messageId !== undefined ? { messageId: ctx.messageId } : {}),
  });
}

/**
 * Ensure a stub store table is snapshotted before dry-run mutation.
 *
 * First touch deep-clones the table; {@link withDryRun} restores it in `finally`.
 *
 * @param ref - Store resource ref (`sql:inventory`, …)
 * @param table - Live in-memory table Map
 */
export function touchDryRunStore(ref: string, table: Map<string, unknown>): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  if (ctx.storeSnapshots.has(ref)) return;
  ctx.storeRefs.set(ref, table);
  ctx.storeSnapshots.set(
    ref,
    new Map([...table.entries()].map(([k, v]) => [k, structuredClone(v)])),
  );
}

/**
 * Roll back every stub store touched during this dry-run scope.
 *
 * @param ctx - Dry-run bag
 */
function rollbackStores(ctx: DryRunContext): void {
  for (const [ref, live] of ctx.storeRefs) {
    const snap = ctx.storeSnapshots.get(ref);
    if (!snap) continue;
    live.clear();
    for (const [k, v] of snap) {
      live.set(k, structuredClone(v));
    }
  }
}

/**
 * Run `fn` with irreversible effects stubbed and stub-store writes rolled back.
 *
 * @param fn - Work that may call `fx.send` / `fx.ask` / `fx.store`
 */
export async function withDryRun<T>(fn: () => T | Promise<T>): Promise<{
  readonly result: T;
  readonly wouldHaveFired: readonly DryRunWouldHaveFired[];
}> {
  const ctx: DryRunContext = {
    wouldHaveFired: [],
    storeSnapshots: new Map(),
    storeRefs: new Map(),
  };
  try {
    const result = await storage.run(ctx, fn);
    return { result, wouldHaveFired: ctx.wouldHaveFired };
  } finally {
    // Always roll back — success or failure. Pass/fail was observed before this.
    rollbackStores(ctx);
  }
}
