/**
 * Console HTTP auth-posture gates — public sentinel vs operator policy.
 */

import { gate, type PolicyGateDecl } from "../../elements/gate.ts";

/** Operator must be present (Console plane). */
export const consoleOperatorGate: PolicyGateDecl = gate.policy(
  "console:operator",
  ({ operator }) => operator.id !== null,
);

/** Gates registered on the Console app runtime. */
export const CONSOLE_GATES = [gate.public, consoleOperatorGate] as const;
