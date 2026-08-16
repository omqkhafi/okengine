/**
 * Keyboard shortcuts reference Sheet for the Store data grid (Ctrl+/).
 */

import type { JSX } from "react";
import { Kbd } from "@/components/ui/kbd";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { modKey } from "@/lib/shortcut.ts";

/** Props for {@link StoreGridShortcuts}. */
export interface StoreGridShortcutsProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

interface ShortcutGroup {
  readonly title: string;
  readonly rows: readonly (readonly [keys: string, description: string])[];
}

const GROUPS: readonly ShortcutGroup[] = [
  {
    title: "Navigation",
    rows: [
      ["↑ ↓ ← →", "Move between cells"],
      ["Tab / Shift+Tab", "Next / previous cell"],
      ["Home / End", "First / last column"],
      ["Ctrl+↑↓←→", "Jump to grid edge"],
      ["Ctrl+Home / End", "First / last cell"],
      ["PgUp / PgDn", "Move one page"],
    ],
  },
  {
    title: "Selection",
    rows: [
      ["Shift+Click / Arrows", "Extend range"],
      ["Ctrl+Click", "Toggle single cell"],
      ["Ctrl+A", "Select all cells"],
      ["Escape", "Clear selection"],
    ],
  },
  {
    title: "Editing",
    rows: [
      ["Enter / F2 / Double-click", "Edit cell"],
      ["Type any character", "Replace cell contents"],
      ["Enter", "Commit + move down"],
      ["Tab / Shift+Tab", "Commit + next / previous"],
      ["Escape", "Cancel edit"],
    ],
  },
  {
    title: "Clipboard",
    rows: [
      ["Ctrl+C", "Copy selected cells"],
      ["Ctrl+X", "Cut selected cells"],
      ["Ctrl+V", "Paste from focused cell"],
      ["Delete / Backspace", "Clear selected cells"],
    ],
  },
  {
    title: "Rows & columns",
    rows: [
      ["Ctrl+Backspace", "Delete selected rows"],
      ["Header click", "Sort (Shift = multi-sort)"],
    ],
  },
  {
    title: "General",
    rows: [
      ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo edit"],
      ["Ctrl+F", "Find / search index"],
      ["Ctrl+/", "Toggle this reference"],
    ],
  },
];

/**
 * Right-side reference listing every grid shortcut. Non-modal (no overlay).
 *
 * @param props - Open state
 */
export function StoreGridShortcuts({ open, onOpenChange }: StoreGridShortcutsProps): JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showOverlay={false}
        className="sm:max-w-sm"
        data-slot="store-grid-shortcuts"
      >
        <SheetHeader>
          <SheetTitle>Keyboard shortcuts</SheetTitle>
          <SheetDescription>Spreadsheet-style navigation, selection, and editing.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          {GROUPS.map((group) => (
            <section key={group.title} className="flex flex-col gap-1.5">
              <h3 className="font-mono text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                {group.title}
              </h3>
              <ul className="flex flex-col gap-1">
                {group.rows.map(([keys, description]) => (
                  <li key={keys} className="flex items-center justify-between gap-3 text-[12px]">
                    <span className="text-muted-foreground">{description}</span>
                    <Kbd className="shrink-0 whitespace-nowrap">
                      {keys.replaceAll("Ctrl", modKey())}
                    </Kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
