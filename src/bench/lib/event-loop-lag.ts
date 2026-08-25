/**
 * Event-loop lag probe — setInterval drift under load.
 */

/** Measure setInterval drift under load. Returns lag samples in ms. */
export function measureEventLoopLag(expectedIntervalMs = 100): {
  lags: () => number[];
  stop: () => void;
} {
  const lags: number[] = [];
  let last = performance.now();
  let alive = true;
  const id = setInterval(() => {
    if (!alive) return;
    const now = performance.now();
    lags.push(Number((now - last - expectedIntervalMs).toFixed(2)));
    last = now;
  }, expectedIntervalMs);
  return {
    lags: () => lags,
    stop: () => {
      alive = false;
      clearInterval(id);
    },
  };
}
