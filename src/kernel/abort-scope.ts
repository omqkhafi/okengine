/**
 * Ambient AbortSignal scope for structured concurrency.
 *
 * Same ALS pattern as dry-run: `fx.all` / `fx.race` enter a child signal so
 * cooperative branches (and future driver plumbing) can observe cancellation
 * without every call site passing a signal argument.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** Never-aborted signal used outside an `all` / `race` branch. */
const NEVER_ABORTED = new AbortController().signal;

const storage = new AsyncLocalStorage<AbortSignal>();

/**
 * AbortSignal for the current async chain, or a never-aborted signal when
 * no structured-concurrency scope is active.
 */
export function currentAbortSignal(): AbortSignal {
  return storage.getStore() ?? NEVER_ABORTED;
}

/**
 * Run `fn` with `signal` as the ambient abort signal.
 *
 * @param signal - Branch / scope signal
 * @param fn - Work that may read {@link currentAbortSignal}
 */
export async function withAbortSignal<T>(
  signal: AbortSignal,
  fn: () => T | Promise<T>,
): Promise<T> {
  return storage.run(signal, fn);
}

/**
 * When `parent` aborts, abort `child` with the same reason.
 *
 * @param parent - Outer signal
 * @param child - Controller to abort
 * @returns Unsubscribe
 */
export function linkAbort(parent: AbortSignal, child: AbortController): () => void {
  if (parent.aborted) {
    child.abort(parent.reason);
    return () => undefined;
  }
  const onAbort = (): void => {
    child.abort(parent.reason);
  };
  parent.addEventListener("abort", onAbort);
  return () => parent.removeEventListener("abort", onAbort);
}

/**
 * True when `err` is an abort rejection (`AbortError` name).
 *
 * @param err - Unknown
 */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Create an `AbortError` matching Web / fetch abort rejections.
 *
 * @param reason - Optional abort reason
 */
export function abortError(reason?: unknown): Error {
  if (typeof DOMException === "function") {
    const message =
      reason instanceof Error
        ? reason.message
        : reason !== undefined
          ? String(reason)
          : "This operation was aborted";
    return new DOMException(message, "AbortError");
  }
  const err = new Error(
    reason instanceof Error
      ? reason.message
      : reason !== undefined
        ? String(reason)
        : "This operation was aborted",
  );
  err.name = "AbortError";
  return err;
}

/**
 * Sleep that rejects promptly when `signal` aborts.
 *
 * Not durable — retry backoff must not journal via `fx.clock.sleep`.
 *
 * @param ms - Milliseconds
 * @param signal - Optional abort signal
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal.reason));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError(signal?.reason));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
