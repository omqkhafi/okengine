/**
 * Privacy erase — crypto-shred a subject across the runs store (and later
 * journal / channel receipts). Deletes the Vault key, not the terabytes.
 */

import { eraseSubject, subjectKeyName, type SubjectKeyVault } from "./shred.ts";

/** Options for {@link privacyErase}. */
export interface PrivacyEraseOptions {
  /** Subject to erase. */
  readonly subjectId: string;
  /** Subject-key vault (required). */
  readonly subjectKeys: SubjectKeyVault;
  /** Write stdout. */
  readonly write?: (text: string) => void;
}

/** Result of a privacy erase. */
export interface PrivacyEraseResult {
  /** Subject id. */
  readonly subjectId: string;
  /** Vault key that was targeted. */
  readonly key: string;
  /** Whether the key existed and was deleted. */
  readonly deleted: boolean;
}

/**
 * Crypto-shred a subject by deleting their per-subject Vault key.
 *
 * @param options - Subject + vault
 */
export function privacyErase(options: PrivacyEraseOptions): PrivacyEraseResult {
  const key = subjectKeyName(options.subjectId);
  const deleted = eraseSubject(options.subjectKeys, options.subjectId);
  const write = options.write ?? ((t) => process.stdout.write(t));
  write(
    deleted
      ? `oke privacy erase: shredded subject ${options.subjectId} (deleted ${key})\n`
      : `oke privacy erase: no key for subject ${options.subjectId} (${key})\n`,
  );
  return { subjectId: options.subjectId, key, deleted };
}
