/**
 * Reversibility-governed confirmation (console §10.5).
 *
 * - Reversible → execute immediately, 15-second undo, no dialogue.
 * - Irreversible → typed confirmation + recorded reason. No undo.
 */

import type { UiEffectTier } from "./tiers.ts";

/** Undo window for reversible actions. */
export const UNDO_WINDOW_MS = 15_000;

/** Confirmation strategy derived from effect tier. */
export type ConfirmationPattern =
  | { readonly kind: "undo"; readonly windowMs: number }
  | {
      readonly kind: "typed";
      readonly phrase: string;
      readonly requireReason: true;
    };

/**
 * Derive the confirmation pattern from a flow's peak effect tier and
 * environment. External effects in production require typed confirmation.
 *
 * @param peakTier - Peak effect tier
 * @param options - Environment
 */
export function confirmationFor(
  peakTier: UiEffectTier | "none",
  options: { readonly production: boolean } = { production: true },
): ConfirmationPattern {
  if (peakTier === "external" && options.production) {
    return {
      kind: "typed",
      phrase: "INVOKE",
      requireReason: true,
    };
  }
  return { kind: "undo", windowMs: UNDO_WINDOW_MS };
}

/** Result of validating a typed confirmation. */
export interface TypedConfirmInput {
  readonly typed: string;
  readonly reason: string;
  readonly phrase: string;
}

/** Validation errors for typed confirm. */
export interface TypedConfirmErrors {
  readonly typed?: string;
  readonly reason?: string;
}

/**
 * Validate typed confirmation + reason for an irreversible action.
 *
 * @param input - Operator input
 */
export function validateTypedConfirm(
  input: TypedConfirmInput,
): TypedConfirmErrors | null {
  const errors: {
    typed?: string;
    reason?: string;
  } = {};
  if (input.typed.trim() !== input.phrase) {
    errors.typed = `Type ${input.phrase} to confirm`;
  }
  if (input.reason.trim().length < 3) {
    errors.reason = "Reason is required (min 3 characters)";
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

/** Pending undo entry. */
export interface UndoEntry<T = unknown> {
  readonly id: string;
  readonly label: string;
  readonly payload: T;
  readonly expiresAt: number;
  readonly undo: () => void | Promise<void>;
}

/**
 * Create an undo stack that expires entries after {@link UNDO_WINDOW_MS}.
 */
export function createUndoStack(now: () => number = () => Date.now()): {
  readonly entries: readonly UndoEntry[];
  push(entry: Omit<UndoEntry, "expiresAt"> & { readonly windowMs?: number }): void;
  undo(id: string): Promise<boolean>;
  prune(): void;
} {
  const entries: UndoEntry[] = [];
  return {
    get entries() {
      return entries;
    },
    push(entry): void {
      const windowMs = entry.windowMs ?? UNDO_WINDOW_MS;
      entries.push({
        id: entry.id,
        label: entry.label,
        payload: entry.payload,
        undo: entry.undo,
        expiresAt: now() + windowMs,
      });
    },
    async undo(id: string): Promise<boolean> {
      const i = entries.findIndex((e) => e.id === id);
      if (i < 0) return false;
      const entry = entries[i];
      if (!entry) return false;
      if (now() > entry.expiresAt) {
        entries.splice(i, 1);
        return false;
      }
      entries.splice(i, 1);
      await entry.undo();
      return true;
    },
    prune(): void {
      const t = now();
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e && e.expiresAt <= t) entries.splice(i, 1);
      }
    },
  };
}
