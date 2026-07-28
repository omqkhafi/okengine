import { expect, test } from "bun:test";
import { ELEMENTS, type ElementPreviewKind } from "@/lib/elements";
import {
  CHIP_TONE,
  ELEMENT_CHIP,
  elementTone,
  elementToneVar,
  toneForElementName,
} from "@/lib/element-tones";

/** Canonical inks — lattice, Features primary chips, and SVG vars must agree. */
const EXPECTED: Record<ElementPreviewKind, string> = {
  flow: "sky",
  signal: "amber",
  store: "teal",
  clock: "orange",
  gate: "emerald",
  vault: "yellow",
  channel: "cyan",
  ai: "rose",
};

test("ELEMENT_CHIP assigns one canonical tone per element", () => {
  for (const element of ELEMENTS) {
    expect(ELEMENT_CHIP[element.preview]).toBe(EXPECTED[element.preview]);
  }
});

test("CHIP_TONE covers every ElementChipTone used by ELEMENT_CHIP", () => {
  for (const tone of Object.values(ELEMENT_CHIP)) {
    expect(CHIP_TONE[tone]).toBeDefined();
    expect(CHIP_TONE[tone].idle).toContain(tone);
    expect(CHIP_TONE[tone].mark).toContain(tone);
  }
});

test("elementTone returns the wash set for the canonical chip", () => {
  for (const element of ELEMENTS) {
    expect(elementTone(element.preview)).toBe(CHIP_TONE[ELEMENT_CHIP[element.preview]]);
  }
});

test("elementToneVar binds each preview to its CSS custom property", () => {
  for (const element of ELEMENTS) {
    expect(elementToneVar(element.preview)).toBe(`var(--oke-el-${element.preview})`);
  }
});

test("toneForElementName resolves every element name", () => {
  for (const element of ELEMENTS) {
    expect(toneForElementName(element.name)).toBe(`var(--oke-el-${element.preview})`);
  }
});

test("toneForElementName falls back for an unknown name", () => {
  expect(toneForElementName("Ninth")).toBe("var(--color-fd-foreground)");
});
