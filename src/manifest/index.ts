/**
 * Manifest — the 100-year artifact.
 *
 * Public contract: `manifest.v1.schema.json`
 */

export type * from "./types.ts";
export { diffManifest, highestSeverity } from "./diff.ts";
export { flowNameFromPath, isDeclaredBreak, undeclaredContractBreaks } from "./undeclared.ts";
export {
  assertLosslessRoundTrip,
  loadManifestSchema,
  ManifestValidationError,
  manifestSchemaUrl,
  parseManifest,
  serializeManifest,
  validateManifest,
  type ManifestValidationIssue,
  type ManifestValidationResult,
} from "./validate.ts";
