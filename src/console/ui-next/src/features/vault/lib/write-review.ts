/**
 * Proportionate write review — pause before create / set / rotate.
 *
 * Opening a review never writes. Only {@link confirmVaultWrite} may call
 * the commit callback. Cancel returns null and must not commit.
 */

/** Which Console vault write is under review. */
export type VaultWriteAction = "create" | "set" | "rotate";

/** Draft collected on the sheet before the review dialog. */
export interface VaultWriteDraft {
  readonly action: VaultWriteAction;
  readonly name: string;
  readonly value: string;
  readonly sensitive: boolean;
  readonly reason?: string;
  readonly kind?: "secret" | "config";
  readonly description?: string;
  readonly rotate?: string;
}

/** Payload the review dialog may show — never the secret cleartext. */
export interface VaultWriteReviewView {
  readonly action: VaultWriteAction;
  readonly name: string;
  readonly kind: "secret" | "config";
  readonly fingerprint: string;
  /** Config may show the value; secrets stay null. */
  readonly preview: string | null;
  readonly reason: string | null;
  readonly rotate: string | null;
}

/** Review held until Confirm. `commit` is for the mutation only. */
export interface VaultWriteReview extends VaultWriteReviewView {
  readonly commit: {
    readonly name: string;
    readonly value: string;
    readonly reason: string | null;
    readonly kind: "secret" | "config";
    readonly description: string;
    readonly rotate: string;
  };
}

/**
 * SHA-256 fingerprint matching the Vault runtime (`sha256:` + 16 hex).
 *
 * @param value - Cleartext
 */
export async function fingerprintVaultValue(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex.slice(0, 16)}`;
}

/**
 * Build a review. Does not write.
 *
 * @param draft - Sheet fields
 */
export async function openVaultWriteReview(
  draft: VaultWriteDraft,
): Promise<VaultWriteReview | { readonly error: string }> {
  const name = draft.name.trim();
  const value = draft.value;
  if (name.length === 0) return { error: "Name is required" };
  if (value.trim().length === 0) return { error: "Value is required" };
  if (draft.action !== "create") {
    const reason = draft.reason?.trim() ?? "";
    if (reason.length < 3) return { error: "Reason is required" };
  }
  const kind = draft.kind ?? (draft.sensitive ? "secret" : "config");
  const fingerprint = await fingerprintVaultValue(value);
  const reason = draft.action === "create" ? null : (draft.reason?.trim() ?? null);
  return {
    action: draft.action,
    name,
    kind,
    fingerprint,
    preview: draft.sensitive ? null : value,
    reason,
    rotate: draft.rotate ?? null,
    commit: {
      name,
      value,
      reason,
      kind,
      description: draft.description?.trim() ?? "",
      rotate: draft.rotate ?? (kind === "secret" ? "90d" : "never"),
    },
  };
}

/**
 * The only path that may invoke `commit`. No-op when review is null (Cancel).
 *
 * @param review - Open review, or null after cancel
 * @param commit - Mutation
 */
export function confirmVaultWrite<T>(
  review: VaultWriteReview | null,
  commit: (review: VaultWriteReview) => T,
): T | null {
  if (review === null) return null;
  return commit(review);
}

/**
 * Abort the review. Callers must pass the result into {@link confirmVaultWrite}.
 */
export function cancelVaultWrite(): null {
  return null;
}
