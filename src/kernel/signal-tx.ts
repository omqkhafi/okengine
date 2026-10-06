/**
 * Ambient signal transaction for `fx.store().transaction`.
 *
 * Emits inside the callback stage on {@link SignalTransaction} and publish
 * only after the SQL transaction commits.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { SignalTransaction } from "../drivers/signal-types.ts";

const storage = new AsyncLocalStorage<SignalTransaction>();

/**
 * The signal transaction wrapping the current async frame, if any.
 */
export function currentSignalTransaction(): SignalTransaction | undefined {
  return storage.getStore();
}

/**
 * Run `fn` with `tx` as the ambient signal transaction.
 *
 * @param tx - Open signal transaction
 * @param fn - Body
 */
export function runInSignalTransaction<T>(tx: SignalTransaction, fn: () => Promise<T>): Promise<T> {
  return storage.run(tx, fn);
}
