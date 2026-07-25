import { expect, test } from 'bun:test';
import { ELEMENTS } from '@/lib/elements';
import { elementToneVar, toneForElementName } from '@/lib/element-tones';

test('elementToneVar binds each preview to its CSS custom property', () => {
  for (const element of ELEMENTS) {
    expect(elementToneVar(element.preview)).toBe(`var(--oke-el-${element.preview})`);
  }
});

test('toneForElementName resolves every element name', () => {
  for (const element of ELEMENTS) {
    expect(toneForElementName(element.name)).toBe(`var(--oke-el-${element.preview})`);
  }
});

test('toneForElementName falls back for an unknown name', () => {
  expect(toneForElementName('Ninth')).toBe('var(--color-fd-foreground)');
});
