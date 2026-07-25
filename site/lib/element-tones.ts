import { ELEMENTS, type ElementPreviewKind } from '@/lib/elements';

/**
 * Soft ink CSS variable for an element — SVG presentation attributes bind to
 * these (see `app/global.css`). Never use Tailwind `fill-*` / `stroke-*` here:
 * those utilities are not in the Fumadocs preset build.
 *
 * @param preview - Element preview kind (`flow`, `signal`, …)
 */
export function elementToneVar(preview: ElementPreviewKind): string {
  return `var(--oke-el-${preview})`;
}

/**
 * Soft ink for an element by its display name (`Flow`, `Signal`, …).
 * Falls back to the theme foreground if the name is unknown.
 *
 * @param name - Element name from `ELEMENTS` / zoo concerns
 */
export function toneForElementName(name: string): string {
  const element = ELEMENTS.find((entry) => entry.name === name);
  return element ? elementToneVar(element.preview) : 'var(--color-fd-foreground)';
}
