/**
 * Console operator password policy — stricter than app-user defaults.
 * Used by claim / operator create and mirrored by the Console UI meter.
 */

import {
  assertPasswordPolicy,
  generatePassword,
  passwordHasSpecial,
  resolvePasswordPolicy,
  type PasswordPolicyOptions,
} from "../auth/password-policy.ts";

/**
 * Console-specific password policy: length 12+, upper, lower, number, special.
 */
export const CONSOLE_PASSWORD_POLICY = {
  minLength: 12,
  requireLetter: true,
  requireNumber: true,
  requireUppercase: true,
  requireLowercase: true,
  requireSpecial: true,
} as const satisfies PasswordPolicyOptions;

/** Rule row for UI checklists / meters. */
export type ConsolePasswordRule = {
  readonly id: string;
  readonly label: string;
  readonly met: boolean;
};

/**
 * Evaluate a password against {@link CONSOLE_PASSWORD_POLICY}.
 * Checklist rows mirror the same predicates {@link assertPasswordPolicy} enforces.
 *
 * @param password - Plaintext
 */
export function evaluateConsolePasswordRules(password: string): readonly ConsolePasswordRule[] {
  const policy = resolvePasswordPolicy(CONSOLE_PASSWORD_POLICY);
  return [
    {
      id: "length",
      label: `At least ${policy.minLength} characters`,
      met: password.length >= policy.minLength,
    },
    {
      id: "uppercase",
      label: "Contains an uppercase letter",
      met: /[A-Z]/.test(password),
    },
    {
      id: "lowercase",
      label: "Contains a lowercase letter",
      met: /[a-z]/.test(password),
    },
    {
      id: "number",
      label: "Contains a number",
      met: /\d/.test(password),
    },
    {
      id: "special",
      label: "Contains a special character",
      met: passwordHasSpecial(password),
    },
  ] as const;
}

/**
 * Whether every Console UI checklist rule is met (same outcome as server assert).
 *
 * @param password - Plaintext
 */
export function consolePasswordMeetsPolicy(password: string): boolean {
  try {
    assertPasswordPolicy(password, CONSOLE_PASSWORD_POLICY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Random operator password that satisfies {@link CONSOLE_PASSWORD_POLICY}.
 */
export function generateConsolePassword(): string {
  return generatePassword(CONSOLE_PASSWORD_POLICY);
}
