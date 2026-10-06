/**
 * Pull-request manifest diff.
 *
 * Writes the comment body, then exits non-zero only for undeclared
 * contract breaks. Widening changes stay in the comment.
 *
 *   bun src/cli/manifest-pr-diff.ts comment.md
 */

import { writeFileSync } from "node:fs";
import { formatManifestDiffComment, runDoctorDiff } from "./doctor-diff.ts";

const out = process.argv[2] ?? "manifest-diff.md";
const result = await runDoctorDiff({ write: () => {} });
writeFileSync(out, formatManifestDiffComment(result.allChanges));
process.exit(result.code);
