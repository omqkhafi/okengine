/**
 * Shared Clack select helpers with optional ← Back.
 */

import { isCancel, select } from "@clack/prompts";

/** Sentinel — go back one wizard step (shown as "← Back" in selects). */
export const WIZARD_BACK = "__back__" as const;
/** {@link WIZARD_BACK} type alias. */
export type WizardBack = typeof WIZARD_BACK;

/**
 * Append "← Back" when allowed — pure helper for tests + {@link selectWithBack}.
 *
 * @param options - Choices
 * @param allowBack - Whether to append Back
 */
export function withBackOption(
  options: readonly { value: string; label: string; hint?: string }[],
  allowBack: boolean,
): readonly { value: string; label: string; hint?: string }[] {
  if (!allowBack) return options;
  return [...options, { value: WIZARD_BACK, label: "←  Back" }];
}

/**
 * Select with an optional trailing "← Back" option.
 *
 * @param message - Prompt
 * @param options - Choices (without back)
 * @param initialValue - Initial selection
 * @param opts - Whether Back is offered
 */
export async function selectWithBack(
  message: string,
  options: readonly { value: string; label: string; hint?: string }[],
  initialValue: string,
  opts: { readonly allowBack: boolean },
): Promise<string | WizardBack | null> {
  const list = [...withBackOption(options, opts.allowBack)];
  const value = await select({
    message,
    options: list,
    initialValue,
  });
  if (isCancel(value)) return null;
  const picked = String(value);
  if (picked === WIZARD_BACK) return WIZARD_BACK;
  return picked;
}
