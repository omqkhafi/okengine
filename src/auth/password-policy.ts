/**
 * Password policy — length + character-class rules (never weaker defaults).
 */

/** Non-alphanumeric special character (any Unicode letter/digit excluded via ASCII class). */
const SPECIAL_CHAR_RE = /[^A-Za-z0-9]/;

/** Options for {@link assertPasswordPolicy}. */
export interface PasswordPolicyOptions {
  /** Minimum length (default {@link DEFAULT_PASSWORD_MIN_LENGTH}). */
  readonly minLength?: number;
  /** Require at least one letter (default true). */
  readonly requireLetter?: boolean;
  /** Require at least one digit (default true). */
  readonly requireNumber?: boolean;
  /** Require at least one uppercase letter (default true). */
  readonly requireUppercase?: boolean;
  /** Require at least one lowercase letter (default true). */
  readonly requireLowercase?: boolean;
  /** Require at least one non-alphanumeric special character (default true). */
  readonly requireSpecial?: boolean;
}

/** Resolved policy with defaults applied. */
export interface ResolvedPasswordPolicy {
  readonly minLength: number;
  readonly requireLetter: boolean;
  readonly requireNumber: boolean;
  readonly requireUppercase: boolean;
  readonly requireLowercase: boolean;
  readonly requireSpecial: boolean;
}

/** Default minimum password length (global / Gate auth). */
export const DEFAULT_PASSWORD_MIN_LENGTH = 8;

/**
 * Global password policy defaults (Gate auth / `createIdentity` / `createOperator`
 * when no `passwordPolicy` is passed). Console claim uses a stricter constant.
 */
export const DEFAULT_PASSWORD_POLICY: ResolvedPasswordPolicy = {
  minLength: DEFAULT_PASSWORD_MIN_LENGTH,
  requireLetter: true,
  requireNumber: true,
  requireUppercase: true,
  requireLowercase: true,
  requireSpecial: true,
};

/**
 * Resolve policy options with safe defaults.
 *
 * @param options - Partial policy
 */
export function resolvePasswordPolicy(options: PasswordPolicyOptions = {}): ResolvedPasswordPolicy {
  return {
    minLength: options.minLength ?? DEFAULT_PASSWORD_POLICY.minLength,
    requireLetter: options.requireLetter ?? DEFAULT_PASSWORD_POLICY.requireLetter,
    requireNumber: options.requireNumber ?? DEFAULT_PASSWORD_POLICY.requireNumber,
    requireUppercase: options.requireUppercase ?? DEFAULT_PASSWORD_POLICY.requireUppercase,
    requireLowercase: options.requireLowercase ?? DEFAULT_PASSWORD_POLICY.requireLowercase,
    requireSpecial: options.requireSpecial ?? DEFAULT_PASSWORD_POLICY.requireSpecial,
  };
}

/**
 * Whether `password` contains a non-alphanumeric special character.
 *
 * @param password - Plaintext
 */
export function passwordHasSpecial(password: string): boolean {
  return SPECIAL_CHAR_RE.test(password);
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
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    reasons.push("requireUppercase");
  }
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    reasons.push("requireLowercase");
  }
  if (policy.requireNumber && !/\d/.test(password)) {
    reasons.push("requireNumber");
  }
  if (policy.requireSpecial && !passwordHasSpecial(password)) {
    reasons.push("requireSpecial");
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
