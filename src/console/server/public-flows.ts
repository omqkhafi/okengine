/**
 * Console flows that may run without an operator session.
 *
 * Kept out of `flows.ts` so `consolePlugin` does not pull the full flow graph.
 */

/** Public setup / session entry flows (no operator session required). */
export const PUBLIC_CONSOLE_FLOWS = new Set([
  "console.setup.status",
  "console.setup.claim",
  "console.session.login",
]);
