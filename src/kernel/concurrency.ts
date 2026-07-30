/**
 * Structured concurrency and retry — plain Promise helpers for `fx`.
 *
 * No generators, no monadic wrapper. Branches are thunks so an AbortController
 * can be installed before work starts. Retry backoff uses non-journaled sleep.
 */

import { parseDurationMs } from "../elements/clock/duration.ts";
import {
  abortableSleep,
  currentAbortSignal,
  isAbortError,
  linkAbort,
  withAbortSignal,
} from "./abort-scope.ts";
import { isJournalSuspend } from "./journal.ts";

/** A unit of work started under an abort scope. */
export type FxThunk<T> = () => T | Promise<T>;

/**
 * Retry policy — same shape as the client transport, with duration strings
 * and optional full jitter (no Schedule DSL).
 */
export interface FxRetryOptions {
  /** Extra attempts after the first (default 0). */
  readonly retries?: number;
  /** Initial delay: ms number or duration string (default 50). */
  readonly delay?: number | string;
  /** Multiplier applied after each retry (default 2). */
  readonly backoff?: number;
  /** Full jitter on delay (default true). */
  readonly jitter?: boolean;
  /** Predicate; default retries thrown errors except abort / journal suspend. */
  readonly when?: (err: unknown) => boolean;
}

/**
 * Default retry filter — skip abort and durable-sleep park.
 *
 * @param err - Thrown value
 */
export function defaultRetryWhen(err: unknown): boolean {
  if (isAbortError(err)) return false;
  if (isJournalSuspend(err)) return false;
  return true;
}

/**
 * Resolve a delay option to milliseconds.
 *
 * @param delay - Number or duration string
 * @param fallback - Default ms
 */
export function resolveRetryDelayMs(delay: number | string | undefined, fallback = 50): number {
  if (delay === undefined) return fallback;
  if (typeof delay === "number") return Math.max(0, delay);
  const parsed = parseDurationMs(delay);
  return parsed > 0 ? parsed : fallback;
}

/**
 * Run thunks in parallel; on first rejection abort siblings and rethrow.
 *
 * @param thunks - Work units (not already-started Promises)
 */
export async function fxAll<const T extends readonly unknown[]>(thunks: {
  readonly [K in keyof T]: FxThunk<T[K]>;
}): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const list = thunks as readonly FxThunk<unknown>[];
  if (list.length === 0) {
    return [] as { -readonly [K in keyof T]: Awaited<T[K]> };
  }

  const parent = currentAbortSignal();
  const controllers = list.map(() => new AbortController());
  const unsubs = controllers.map((c) => linkAbort(parent, c));

  let firstError: unknown;
  const results = await Promise.allSettled(
    list.map((thunk, i) =>
      withAbortSignal(controllers[i]!.signal, async () => {
        try {
          return await thunk();
        } catch (err) {
          if (firstError === undefined) {
            firstError = err;
            for (let j = 0; j < controllers.length; j++) {
              if (j !== i) controllers[j]!.abort(err);
            }
          }
          throw err;
        }
      }),
    ),
  );

  for (const unsub of unsubs) unsub();

  if (firstError !== undefined) throw firstError;
  const values: unknown[] = [];
  for (const r of results) {
    if (r.status === "rejected") throw r.reason;
    values.push(r.value);
  }
  return values as { -readonly [K in keyof T]: Awaited<T[K]> };
}

/**
 * Race thunks; the first settle wins and siblings are aborted.
 *
 * @param thunks - Work units
 */
export async function fxRace<T>(thunks: ReadonlyArray<FxThunk<T>>): Promise<T> {
  if (thunks.length === 0) {
    throw new TypeError("fx.race: empty thunk list");
  }

  const parent = currentAbortSignal();
  const controllers = thunks.map(() => new AbortController());
  const unsubs = controllers.map((c) => linkAbort(parent, c));

  return new Promise<T>((resolve, reject) => {
    let done = false;
    const settle = (ok: boolean, value: unknown): void => {
      if (done) return;
      done = true;
      for (const c of controllers) {
        if (!c.signal.aborted) c.abort();
      }
      for (const unsub of unsubs) unsub();
      if (ok) resolve(value as T);
      else reject(value);
    };

    for (let i = 0; i < thunks.length; i++) {
      const thunk = thunks[i]!;
      const ctrl = controllers[i]!;
      void withAbortSignal(ctrl.signal, () => Promise.resolve().then(thunk)).then(
        (value) => settle(true, value),
        (err: unknown) => settle(false, err),
      );
    }
  });
}

/**
 * Retry a thunk with exponential backoff and optional full jitter.
 *
 * @param fn - Operation
 * @param opts - Retry policy
 */
export async function fxRetry<T>(fn: FxThunk<T>, opts: FxRetryOptions = {}): Promise<T> {
  const retries = Math.max(0, opts.retries ?? 0);
  const backoff = opts.backoff ?? 2;
  const jitter = opts.jitter !== false;
  const when = opts.when ?? defaultRetryWhen;
  let delayMs = resolveRetryDelayMs(opts.delay, 50);
  let attempt = 0;

  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !when(err)) throw err;
      const wait = jitter ? Math.random() * delayMs : delayMs;
      await abortableSleep(wait, currentAbortSignal());
      delayMs *= backoff;
      attempt += 1;
    }
  }
}
