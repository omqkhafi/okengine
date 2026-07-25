import { gate } from "okengine";

/** Trivial shared gate — replace with real policies. */
export const open = gate.policy("open", () => true);
