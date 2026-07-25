/**
 * Recipient PII masking for Channel receipts / inbox (console §9.9 · §4.2).
 */

/** Default mask token when no structured form applies. */
export const CHANNEL_PII_MASK = "[redacted]";

/**
 * Mask an email or phone recipient for operator display.
 *
 * @param to - Cleartext recipient
 */
export function maskRecipient(to: string): string {
  const trimmed = to.trim();
  if (!trimmed) return CHANNEL_PII_MASK;

  if (trimmed.includes("@")) {
    return maskEmail(trimmed);
  }
  if (/^\+?\d[\d\s()-]{5,}$/.test(trimmed)) {
    return maskPhone(trimmed);
  }
  if (trimmed.length <= 2) return CHANNEL_PII_MASK;
  return `${trimmed[0]!}${"*".repeat(Math.min(trimmed.length - 2, 6))}${trimmed.at(-1)!}`;
}

/**
 * Mask an email address: `a***@e***.com`.
 *
 * @param email - Cleartext email
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return CHANNEL_PII_MASK;
  const localMask =
    local.length <= 1 ? "*" : `${local[0]!}${"*".repeat(Math.min(3, local.length - 1))}`;
  const parts = domain.split(".");
  const name = parts[0] ?? domain;
  const tld = parts.length > 1 ? parts.slice(1).join(".") : "";
  const domainMask =
    name.length <= 1
      ? "*"
      : `${name[0]!}${"*".repeat(Math.min(3, name.length - 1))}`;
  return tld ? `${localMask}@${domainMask}.${tld}` : `${localMask}@${domainMask}`;
}

/**
 * Mask a phone number, keeping country prefix + last digits.
 *
 * @param phone - Cleartext phone
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return CHANNEL_PII_MASK;
  const last = digits.slice(-3);
  const prefix = phone.trim().startsWith("+")
    ? `+${digits.slice(0, Math.min(3, digits.length - 3))}`
    : digits.slice(0, Math.min(3, digits.length - 3));
  return `${prefix}***${last}`;
}
