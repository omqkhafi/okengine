/**
 * Console-only failure copy — kept out of kernel built-in catalogs so the
 * edge profile and app exports do not pay for operator-claim strings.
 */

const en = {
  ClaimFailed: "Could not create the first operator.",
  "ClaimFailed.mismatch": "That claim code does not match. Copy it from the boot log.",
  "ClaimFailed.expired": "That claim code expired. Restart `oke dev` for a new one.",
  "ClaimFailed.rate_limited": "Too many claim attempts. Wait a minute and try again.",
  "ClaimFailed.missing": "No claim code is active. Restart `oke dev` to mint one.",
  "ClaimFailed.password_policy":
    "Password needs at least 12 characters, including uppercase, lowercase, a number, and a special character.",
  "ClaimFailed.password_breached":
    "Choose a different password — this one appears in a breach list.",
  SetupClosed: "Setup is closed — an operator already exists. Sign in instead.",
  "SetupClosed.first_operator_exists":
    "Setup is closed — an operator already exists. Sign in instead.",
} as const;

/**
 * Resolve a Console claim/setup failure message (English; boot log is EN).
 *
 * @param code - Failure code
 * @param data - Failure data (may include `reason`)
 */
export function consoleFailureMessage(code: string, data?: unknown): string {
  const reason =
    data !== null &&
    data !== undefined &&
    typeof data === "object" &&
    "reason" in data &&
    typeof (data as { reason: unknown }).reason === "string"
      ? (data as { reason: string }).reason
      : undefined;
  if (reason) {
    const keyed = en[`${code}.${reason}` as keyof typeof en];
    if (keyed !== undefined) return keyed;
  }
  return en[code as keyof typeof en] ?? code;
}
