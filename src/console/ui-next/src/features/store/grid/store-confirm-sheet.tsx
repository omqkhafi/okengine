/**
 * Typed-confirmation Sheet for irreversible Store mutations (EDIT / DELETE).
 */

import type { JSX } from "react";
import { ConfirmSheet } from "@/components/ui/confirm-sheet.tsx";

/** Props for {@link StoreConfirmSheet}. */
export interface StoreConfirmSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Phrase the operator must type (`EDIT` / `DELETE`). */
  readonly phrase: string;
  readonly title: string;
  readonly description: string;
  /** Summary of what will not fire (signals/channels) for edits. */
  readonly willNotFire?: {
    readonly signals: readonly string[];
    readonly channels: readonly string[];
  } | null;
  readonly pending?: boolean;
  readonly error?: string | null;
  readonly onConfirm: (input: { readonly confirmation: string; readonly reason: string }) => void;
}

/**
 * Store wrapper around {@link ConfirmSheet}. `willNotFire` stays Store-specific.
 *
 * @param props - Sheet state + confirm callback
 */
export function StoreConfirmSheet({
  open,
  onOpenChange,
  phrase,
  title,
  description,
  willNotFire,
  pending = false,
  error,
  onConfirm,
}: StoreConfirmSheetProps): JSX.Element {
  return (
    <ConfirmSheet
      open={open}
      onOpenChange={onOpenChange}
      phrase={phrase}
      title={title}
      description={description}
      pending={pending}
      error={error}
      slot="store-confirm-sheet"
      onConfirm={onConfirm}
    >
      {willNotFire && (willNotFire.signals.length > 0 || willNotFire.channels.length > 0) ? (
        <div className="px-4 py-3">
          <div
            className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300"
            role="status"
            data-slot="will-not-fire"
          >
            <p className="font-medium">This direct edit will not fire:</p>
            {willNotFire.signals.length > 0 ? (
              <p>signals: {willNotFire.signals.join(", ")}</p>
            ) : null}
            {willNotFire.channels.length > 0 ? (
              <p>channels: {willNotFire.channels.join(", ")}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </ConfirmSheet>
  );
}
