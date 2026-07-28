/**
 * Compiler: Manifest extraction (oxc) · AoT (Sucrose + `new Function`) · dynamic fallback.
 */

export {
  compileAot,
  createInterpretedParseValidate,
  sucrose,
  type CompiledParseValidate,
  type CompiledRoute,
  type CompileRouteOptions,
  type ContextInference,
  type ParseValidateResult,
  type SucroseOptions,
} from "./aot.ts";

export { compileDynamic, compileRoute, FULL_INFERENCE } from "./dynamic.ts";

export {
  assembleInput,
  emptyInference,
  extractParts,
  mergeInference,
  parseBody,
  parseCookie,
  parseHeaders,
  parseQuery,
  pathParamNames,
  type InputParts,
  type MutableInference,
} from "./http-parse.ts";

export {
  encodeExecuteResult,
  encodeFailure,
  encodeSuccess,
  statusForFailure,
  type FailureEnvelope,
  type SuccessEnvelope,
} from "./response.ts";

export {
  deepMatch,
  extractFromSources,
  extractManifest,
  lineAt,
  type ExtractManifestOptions,
  type SourceFile,
} from "./extract.ts";

export {
  inferEffects,
  type InferBinding,
  type InferEffectsOptions,
  type InferredEffects,
} from "./effects-infer.ts";

export {
  emitManifest,
  manifestPathIn,
  MANIFEST_FILENAME,
  type EmitManifestOptions,
} from "./emit.ts";
