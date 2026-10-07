/**
 * Bundle entry for the reported decision-module gzip row.
 * Not on the kernel edge graph.
 */

import { runFxDecide } from "./fx-decide.ts";

/** Anchor so minify keeps the decision module. */
export function __okeDecisionBudgetAnchor(): typeof runFxDecide {
  return runFxDecide;
}
