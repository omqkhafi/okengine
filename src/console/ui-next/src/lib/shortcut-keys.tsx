/**
 * Shared {@link Kbd} rendering for Console chords.
 */

import type { JSX } from "react";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

/**
 * Render a chord as {@link Kbd} caps.
 *
 * @param props - Key labels in press order
 */
export function ShortcutKeys({
  keys,
  className,
}: {
  readonly keys: readonly string[];
  readonly className?: string;
}): JSX.Element {
  return (
    <KbdGroup className={className}>
      {keys.map((key, index) => (
        <Kbd key={`${key}-${String(index)}`}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}

/**
 * Label + key caps for a sidebar / tooltip popup.
 *
 * @param props - Visible name and chord
 */
export function ShortcutTipLabel({
  label,
  keys,
}: {
  readonly label: string;
  readonly keys: readonly string[];
}): JSX.Element {
  return (
    <>
      {label}
      <ShortcutKeys keys={keys} />
    </>
  );
}
