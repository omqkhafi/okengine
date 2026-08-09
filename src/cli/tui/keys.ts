/**
 * Shared keyboard mapping for Ink `useInput` and pure tests.
 * Parity with legacy `parseDevControlKey` (`? r q u x`).
 */

/** Dev control action from a keypress. */
export type DevControlKey = "?" | "r" | "q" | "u" | "x";

/**
 * Map Ink input (+ ctrl) to a control key.
 *
 * @param input - Character from useInput
 * @param key - Ink key modifiers
 */
export function mapDevControlInput(
  input: string,
  key: { readonly ctrl?: boolean },
): DevControlKey | null {
  if (key.ctrl && input === "c") return "q";
  if (input === "?" || input === "h" || input === "H") return "?";
  if (input === "q" || input === "Q") return "q";
  if (input === "r" || input === "R") return "r";
  if (input === "u" || input === "U") return "u";
  if (input === "x" || input === "X") return "x";
  return null;
}
