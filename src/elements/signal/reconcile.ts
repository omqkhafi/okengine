/**
 * Boot-time reconciliation — declared Manifest → Store (console §5 · §9.4).
 *
 * Rows that vanished from the code are marked `orphaned`, never deleted.
 * Silently dropping a queue that still holds messages is unacceptable.
 */

import type { SignalDelivery } from "../../manifest/types.ts";
import type { SignalDecl } from "./declare.ts";

/** Signal lifecycle status in `oke_signal_config`. */
export type SignalConfigStatus = "active" | "orphaned";

/** Reconciled signal config row. */
export interface SignalConfigRow {
  readonly name: string;
  readonly delivery: SignalDelivery;
  readonly retries: number;
  readonly deadLetter: boolean;
  readonly schema?: unknown;
  readonly status: SignalConfigStatus;
}

/** Store surface for reconciled signal config. */
export interface SignalConfigStore {
  /**
   * @param name - Signal name
   */
  get(name: string): Promise<SignalConfigRow | undefined>;
  /**
   * @param row - Full row
   */
  put(row: SignalConfigRow): Promise<void>;
  /** All rows currently in the store. */
  list(): Promise<readonly SignalConfigRow[]>;
}

/** Result of one reconciliation pass. */
export interface SignalReconcileResult {
  /** Names upserted / refreshed as active. */
  readonly active: readonly string[];
  /** Names marked orphaned (present in store, absent from code). */
  readonly orphaned: readonly string[];
  /** Snapshot of every row after reconciliation. */
  readonly rows: readonly SignalConfigRow[];
}

/**
 * Reconcile declared signals into the Store.
 *
 * - Declared signals are upserted (`status: "active"`).
 * - Store rows missing from declarations are marked `orphaned` (not deleted).
 *
 * @param declared - Signals from the Manifest / code
 * @param store - Signal config store (`oke_signal_config`)
 */
export async function reconcileSignals(
  declared: readonly SignalDecl[],
  store: SignalConfigStore,
): Promise<SignalReconcileResult> {
  const declaredByName = new Map(declared.map((d) => [d.name, d]));
  const active: string[] = [];
  const orphaned: string[] = [];

  for (const decl of declared) {
    const row: SignalConfigRow = {
      name: decl.name,
      delivery: decl.delivery,
      retries: decl.retries,
      deadLetter: decl.deadLetter,
      schema: decl.schema,
      status: "active",
    };
    await store.put(row);
    active.push(decl.name);
  }

  for (const existing of await store.list()) {
    if (declaredByName.has(existing.name)) continue;
    if (existing.status === "orphaned") {
      orphaned.push(existing.name);
      continue;
    }
    await store.put({
      ...existing,
      status: "orphaned",
    });
    orphaned.push(existing.name);
  }

  return {
    active,
    orphaned,
    rows: await store.list(),
  };
}

/**
 * In-memory signal config store for tests / Console operator plane.
 *
 * @param seed - Optional initial rows
 */
export function createMemorySignalConfigStore(
  seed?: readonly SignalConfigRow[],
): SignalConfigStore {
  const rows = new Map<string, SignalConfigRow>();
  for (const r of seed ?? []) {
    rows.set(r.name, structuredClone(r));
  }
  return {
    async get(name) {
      const r = rows.get(name);
      return r ? structuredClone(r) : undefined;
    },
    async put(row) {
      rows.set(row.name, structuredClone(row));
    },
    async list() {
      return [...rows.values()].map((r) => structuredClone(r));
    },
  };
}
