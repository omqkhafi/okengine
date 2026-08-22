/**
 * Callback-set → {@link AsyncIterable} adapter for {@link SignalBus.live}.
 */

import type { LiveEvent } from "./signal-types.ts";

/**
 * Turn a live subscriber (replay-then-push) into an async iterable.
 *
 * `start` must register `emit` and replay retained events into it before
 * resolving; `drain` later pushes new events through the same `emit`.
 *
 * @param start - Register + replay; return unsubscribe
 */
export function createLiveIterable(
  start: (emit: (event: LiveEvent) => void) => (() => void) | Promise<() => void>,
): AsyncIterable<LiveEvent> {
  return {
    [Symbol.asyncIterator]() {
      const queue: LiveEvent[] = [];
      let notify: (() => void) | undefined;
      let finished = false;
      let unsub: (() => void) | undefined;
      let started: Promise<void> | undefined;

      const ensure = (): Promise<void> => {
        if (started) return started;
        const emit = (event: LiveEvent): void => {
          queue.push(event);
          notify?.();
        };
        const result = start(emit);
        if (typeof result === "function") {
          unsub = result;
          started = Promise.resolve();
          return started;
        }
        started = result.then((fn) => {
          unsub = fn;
        });
        return started;
      };

      return {
        async next() {
          await ensure();
          for (;;) {
            const nextEvent = queue.shift();
            if (nextEvent !== undefined) return { done: false, value: nextEvent };
            if (finished) return { done: true, value: undefined };
            await new Promise<void>((resolve) => {
              notify = resolve;
            });
          }
        },
        async return() {
          finished = true;
          unsub?.();
          notify?.();
          return { done: true, value: undefined };
        },
      };
    },
  };
}
