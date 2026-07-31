/**
 * Password policy — length + character-class rules (never weaker defaults).
 */

/** Options for {@link assertPasswordPolicy}. */
export interface PasswordPolicyOptions {
  /** Minimum length (default 12). */
  readonly minLength?: number;
  /** Require at least one letter (default true). */
  readonly requireLetter?: boolean;
  /** Require at least one digit (default true). */
  readonly requireNumber?: boolean;
  /** Require at least one non-alphanumeric symbol (default false). */
  readonly requireSymbol?: boolean;
}

/** Resolved policy with defaults applied. */
export interface ResolvedPasswordPolicy {
  readonly minLength: number;
  readonly requireLetter: boolean;
  readonly requireNumber: boolean;
  readonly requireSymbol: boolean;
}

/** Default minimum password length. */
export const DEFAULT_PASSWORD_MIN_LENGTH = 12;

/**
 * Resolve policy options with safe defaults.
 *
 * @param options - Partial policy
 */
export function resolvePasswordPolicy(options: PasswordPolicyOptions = {}): ResolvedPasswordPolicy {
  return {
    minLength: options.minLength ?? DEFAULT_PASSWORD_MIN_LENGTH,
    requireLetter: options.requireLetter ?? true,
    requireNumber: options.requireNumber ?? true,
    requireSymbol: options.requireSymbol ?? false,
  };
}

/**
 * Validate a password against policy. Throws {@link PasswordPolicyError}.
 *
 * @param password - Plaintext
 * @param options - Policy (defaults applied)
 */
export function assertPasswordPolicy(password: string, options: PasswordPolicyOptions = {}): void {
  const policy = resolvePasswordPolicy(options);
  const reasons: string[] = [];
  if (password.length < policy.minLength) {
    reasons.push(`minLength ${policy.minLength} (got ${password.length})`);
  }
  if (policy.requireLetter && !/[A-Za-z]/.test(password)) {
    reasons.push("requireLetter");
  }
  if (policy.requireNumber && !/\d/.test(password)) {
    reasons.push("requireNumber");
  }
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) {
    reasons.push("requireSymbol");
  }
  if (reasons.length > 0) {
    throw new PasswordPolicyError(reasons);
  }
}

/** Password failed policy checks. */
export class PasswordPolicyError extends Error {
  readonly reasons: readonly string[];

  constructor(reasons: readonly string[]) {
    super(`password policy failed: ${reasons.join(", ")}`);
    this.name = "PasswordPolicyError";
    this.reasons = reasons;
  }
}
