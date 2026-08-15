/**
 * Eight-element HugeIcons vocabulary — one glyph language for Console.
 */

import { describe, expect, test } from "bun:test";
import { ELEMENT_ICONS, elementIcon, type OkeElement } from "./element-icons.ts";

describe("ELEMENT_ICONS", () => {
  test("covers all eight elements with distinct icons", () => {
    const elements: readonly OkeElement[] = [
      "flow",
      "signal",
      "store",
      "clock",
      "gate",
      "vault",
      "channel",
      "ai",
    ];
    const icons = new Set(elements.map((e) => ELEMENT_ICONS[e].icon));
    expect(icons.size).toBe(8);
    for (const e of elements) {
      expect(elementIcon(e).label.length).toBeGreaterThan(0);
      expect(elementIcon(e).symbol).toHaveLength(2);
      expect(elementIcon(e).icon).toBe(ELEMENT_ICONS[e].icon);
    }
    expect(elements.map((e) => ELEMENT_ICONS[e].symbol)).toEqual([
      "Fl",
      "Sg",
      "St",
      "Ck",
      "Gt",
      "Vt",
      "Ch",
      "Ai",
    ]);
  });
});
