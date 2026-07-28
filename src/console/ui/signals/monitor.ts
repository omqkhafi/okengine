/**
 * Live payload monitor — pause / export; auto-pauses on scroll (console §9.4).
 */

/** Monitor state. */
export interface LiveMonitorState {
  readonly paused: boolean;
  readonly autoPausedByScroll: boolean;
  readonly payloads: readonly unknown[];
}

/**
 * Apply a new live payload when the monitor is not paused.
 *
 * @param state - Current
 * @param payload - Incoming
 * @param cap - Max retained
 */
export function appendLivePayload(
  state: LiveMonitorState,
  payload: unknown,
  cap = 50,
): LiveMonitorState {
  if (state.paused) return state;
  const payloads = [...state.payloads, payload];
  while (payloads.length > cap) payloads.shift();
  return { ...state, payloads };
}

/**
 * Operator toggles pause.
 *
 * @param state - Current
 * @param paused - Desired
 */
export function setPaused(state: LiveMonitorState, paused: boolean): LiveMonitorState {
  return {
    ...state,
    paused,
    autoPausedByScroll: paused ? state.autoPausedByScroll : false,
  };
}

/**
 * Scroll interaction auto-pauses the stream so the operator can read.
 *
 * @param state - Current
 */
export function onMonitorScroll(state: LiveMonitorState): LiveMonitorState {
  if (state.paused) return state;
  return { ...state, paused: true, autoPausedByScroll: true };
}

/**
 * Export retained payloads as JSON.
 *
 * @param payloads - Retained rows
 */
export function exportLivePayloads(payloads: readonly unknown[]): string {
  return JSON.stringify(payloads, null, 2);
}

/**
 * Create an empty monitor.
 *
 * @param seed - Optional initial payloads
 */
export function createLiveMonitor(seed: readonly unknown[] = []): LiveMonitorState {
  return {
    paused: false,
    autoPausedByScroll: false,
    payloads: [...seed],
  };
}
