/**
 * OKE1900 — kept off the kernel edge profile.
 *
 * Effect inference throws a plain `Error` (`OKE1900` in the message) from
 * `okengine/compiler`. This definition is registry-only so the compiler
 * chunk does not import the kernel error module.
 */

import type { OkeErrorDefinition } from "./errors.ts";

/**
 * A Flow hides `fx` from effect inference, or an explicit `effects` block
 * omits an effect the walk can see.
 */
/**
 * A durable Flow calls `fx.fetch` or `fx.send` outside `fx.step`.
 * Those effects are irreversible and must be an explicit step so replay skips them.
 */
export const DURABLE_BARE_EFFECT: OkeErrorDefinition = {
  code: 1901,
  domain: "compiler",
  cause: 'Durable flow "{flow}" calls fx.{effect} outside fx.step.',
  fix: "Wrap fx.fetch and fx.send in fx.step so replay returns the journaled value instead of repeating the call.",
};

export const FX_INFERENCE_OPAQUE: OkeErrorDefinition = {
  code: 1900,
  domain: "compiler",
  cause: 'Flow "{flow}" hides fx from effect inference ({detail}).',
  fix: "Name the parameter fx, keep chain aliases in the same function, and include every effect inference can see. An effects block may add keys; it cannot omit keys inference can see.",
};
