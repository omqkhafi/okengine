/**
 * One live `bun --hot` generation for `oke dev`.
 *
 * Soft reload re-runs the app runner in the same process. The previous
 * boot's scheduler and Postgres pools stay open unless this slot disposes
 * them before the next `boot()`.
 */

const DEV_HOT_SLOT = Symbol.for("oke.dev.hot.generation");

/** Work the previous runner evaluation must undo before the next boot. */
export type DevHotGeneration = {
  /** Stop schedulers, drop signal handlers, and close this generation's pools. */
  dispose(): Promise<void>;
};

type HotBox = { current?: DevHotGeneration };

function hotBox(): HotBox {
  const g = globalThis as typeof globalThis & { [DEV_HOT_SLOT]?: HotBox };
  let box = g[DEV_HOT_SLOT];
  if (!box) {
    box = {};
    g[DEV_HOT_SLOT] = box;
  }
  return box;
}

/**
 * Take the previous generation, if a soft reload left one.
 *
 * Clears the slot so a failed dispose cannot be retried against a half-stopped app.
 */
export function takeDevHotGeneration(): DevHotGeneration | undefined {
  const box = hotBox();
  const prev = box.current;
  box.current = undefined;
  return prev;
}

/**
 * Remember this evaluation so the next soft reload can dispose it.
 *
 * @param generation - Stop handle for the boot that just started
 */
export function installDevHotGeneration(generation: DevHotGeneration): void {
  hotBox().current = generation;
}
