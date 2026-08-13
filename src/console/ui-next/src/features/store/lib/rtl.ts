/**
 * Bidi helpers for mixed RTL/LTR grid cells (e.g. Arabic text next to Latin ids).
 */

const RTL_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

/**
 * True when the first strong directional character is RTL.
 *
 * @param value - Cell value
 */
export function isRtlText(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return RTL_RE.test(value);
}
