/**
 * OKE1070 / OKE1072 — kept off the kernel edge profile.
 *
 * Duplicate or unnamed Flow names throw these at `oke()` construction.
 * `oke()` imports them directly (that graph is not in `budget-entry`).
 * Registry discovery includes this file; the edge `lookupOkeError` path
 * stays off these defs. Extract fails the same collisions with a plain
 * `Error` (`OKE1070` / `OKE1072` in the message) so `okengine/compiler`
 * stays off this module.
 */

import type { OkeErrorDefinition } from "./errors.ts";

/** Two Flow definitions share the same Manifest / `fx.call` name. */
export const FLOW_NAME_DUPLICATE: OkeErrorDefinition = {
  code: 1070,
  domain: "kernel",
  cause: 'Flow "{flow}" is defined twice.',
  fix: 'Give at least one Flow an explicit flow("…") or a distinct tree export.',
};

/**
 * A Signal or Clock consumer still has no Manifest name after tree stamp.
 *
 * Same posture as **OKE1045** for HTTP: nameless `flow({ do })` is allowed
 * until the file-tree / `unit()` stamp runs, then construction fails.
 */
export const FLOW_UNNAMED: OkeErrorDefinition = {
  code: 1072,
  domain: "kernel",
  cause: 'A {kind} flow on "{trigger}" has no name.',
  fix: 'Use flow("unit.export", {…}) or export it from a src/flows/<unit>/ file so the tree can stamp unit.export. A nameless flow({ do }) outside that folder fails even with export const.',
};
