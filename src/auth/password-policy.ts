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

/** Extra options for {@link generatePassword}. */
export interface GeneratePasswordOptions extends PasswordPolicyOptions {
  /** Output length (default `max(minLength, 16)`). */
  readonly length?: number;
}

const GEN_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const GEN_LOWER = "abcdefghijkmnpqrstuvwxyz";
const GEN_DIGITS = "23456789";
const GEN_SPECIAL = "!@#$%^&*-_=+?";

/**
 * Cryptographically random password that satisfies {@link assertPasswordPolicy}.
 * Ambiguous glyphs (`0O1Il`) are omitted so a revealed value is easy to retype.
 *
 * @param options - Policy + optional length
 */
export function generatePassword(options: GeneratePasswordOptions = {}): string {
  const policy = resolvePasswordPolicy(options);
  const length = options.length ?? Math.max(policy.minLength, 16);
  if (length < policy.minLength) {
    throw new Error(`generatePassword: length ${length} is below minLength ${policy.minLength}`);
  }

  const classes: string[] = [];
  if (policy.requireUppercase) classes.push(GEN_UPPER);
  if (policy.requireLowercase) classes.push(GEN_LOWER);
  if (policy.requireLetter && !policy.requireUppercase && !policy.requireLowercase) {
    classes.push(GEN_UPPER + GEN_LOWER);
  }
  if (policy.requireNumber) classes.push(GEN_DIGITS);
  if (policy.requireSpecial) classes.push(GEN_SPECIAL);
  const pool = classes.length > 0 ? classes.join("") : GEN_UPPER + GEN_LOWER + GEN_DIGITS;
  if (length < classes.length) {
    throw new Error(`generatePassword: length ${length} cannot cover ${classes.length} classes`);
  }

  const chars: string[] = classes.map((set) => pickChar(set));
  while (chars.length < length) chars.push(pickChar(pool));
  shuffleInPlace(chars);
  const password = chars.join("");
  assertPasswordPolicy(password, policy);
  return password;
}

function pickChar(set: string): string {
  return set[randomInt(set.length)] ?? set[0]!;
}

function shuffleInPlace(items: string[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const a = items[i]!;
    items[i] = items[j]!;
    items[j] = a;
  }
}

/** Unbiased `0 .. maxExclusive-1` from `crypto.getRandomValues`. */
function randomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error("randomInt: maxExclusive must be a positive integer");
  }
  const bytes = maxExclusive <= 256 ? 1 : 2;
  const range = bytes === 1 ? 256 : 65536;
  if (maxExclusive > range) {
    throw new Error(`randomInt: maxExclusive ${maxExclusive} exceeds ${range}`);
  }
  const limit = range - (range % maxExclusive);
  const buf = new Uint8Array(bytes);
  for (;;) {
    crypto.getRandomValues(buf);
    const value = bytes === 1 ? (buf[0] ?? 0) : ((buf[0] ?? 0) << 8) | (buf[1] ?? 0);
    if (value < limit) return value % maxExclusive;
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
