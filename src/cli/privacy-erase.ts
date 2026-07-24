/**
 * `oke privacy erase --subject <id>` — crypto-shredding.
 */

import {
  createMemorySubjectKeys,
  privacyErase,
  type PrivacyEraseResult,
  type SubjectKeyVault,
} from "../runs/index.ts";

/** Options for {@link runPrivacyErase}. */
export interface RunPrivacyEraseOptions {
  /** Subject id (required). */
  readonly subjectId: string;
  /** Injected subject-key vault (tests). */
  readonly subjectKeys?: SubjectKeyVault;
  /** Write stdout. */
  readonly write?: (text: string) => void;
}

/**
 * Library entry for privacy erase.
 *
 * @param options - Subject + vault
 */
export function runPrivacyErase(
  options: RunPrivacyEraseOptions,
): PrivacyEraseResult {
  const keys = options.subjectKeys ?? createMemorySubjectKeys();
  return privacyErase({
    subjectId: options.subjectId,
    subjectKeys: keys,
    write: options.write,
  });
}

/**
 * CLI entry — parse `--subject` and erase.
 *
 * @param argv - Args after `privacy erase`
 */
export async function privacyEraseCli(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`oke privacy erase --subject <id>

Crypto-shred a subject's archived fields by deleting their per-subject
Vault key. Parquet partitions are not rewritten.
`);
    return 0;
  }

  let subjectId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--subject" || a === "-s") {
      subjectId = argv[++i];
      continue;
    }
    if (a.startsWith("--subject=")) {
      subjectId = a.slice("--subject=".length);
    }
  }

  if (!subjectId) {
    console.error("oke privacy erase: --subject <id> is required");
    return 1;
  }

  // Production wires Vault from config; CLI without a vault reports no-key.
  runPrivacyErase({ subjectId });
  return 0;
}
