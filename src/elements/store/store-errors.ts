/**
 * Store-path error map — SQL, Redis KV, then files. Off the kernel edge graph.
 */

import { isFlowFailure } from "../../kernel/hooks.ts";
import type { FlowFailure } from "../../kernel/errors.ts";
import { filesErrorToFailure, type FilesErrorToFailureOptions } from "./files-errors.ts";
import { kvErrorToFailure, type KvErrorToFailureOptions } from "./kv-errors.ts";
import { sqlErrorToFailure, type SqlErrorToFailureOptions } from "./sql-errors.ts";

/** Shared retryable handling for SQL, Redis KV, and files mappers. */
export type StoreErrorToFailureOptions = SqlErrorToFailureOptions &
  KvErrorToFailureOptions &
  FilesErrorToFailureOptions;

/**
 * Map a store driver throw to a typed failure (SQL, then Redis KV, then files).
 *
 * @param err - Caught value from `fx.store`
 * @param options - Retryable handling
 */
export function storeErrorToFailure(
  err: unknown,
  options: StoreErrorToFailureOptions = {},
): FlowFailure | undefined {
  return (
    sqlErrorToFailure(err, options) ??
    kvErrorToFailure(err, options) ??
    filesErrorToFailure(err, options)
  );
}

/**
 * Run a store op; remap known SQL / Redis / files failures, leave retryable throws.
 *
 * @param fn - Store operation
 */
export async function withStoreErrorMap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isFlowFailure(err)) throw err;
    const mapped = storeErrorToFailure(err, { retryable: "leave" });
    if (mapped) throw mapped;
    throw err;
  }
}
