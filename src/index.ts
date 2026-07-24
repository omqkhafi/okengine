/**
 * `okengine` public entry — kernel surface used by apps and examples.
 *
 * Full ten-export surface lands as elements ship; this entry exposes the
 * executable core (oke · on · flow · http · fx · contracts).
 */

export {
  oke,
  on,
  flow,
  http,
  every,
  internal,
  table,
  fail,
  createFx,
  isFlow,
  isFlowFailure,
  type OkeApp,
  type OkeOptions,
  type FlowDef,
  type FlowFailure,
  type FlowErrorValue,
  type Fx,
  type Binding,
} from "./kernel/index.ts";

export {
  validate,
  isStandardSchema,
  fromTypeBox,
  VALIDATION_ERROR_CODE,
  type StandardSchemaV1,
  type SchemaInput,
  type ValidationErrorData,
} from "./validation/index.ts";

export {
  compileAot,
  compileDynamic,
  compileRoute,
  sucrose,
  type CompiledRoute,
  type ContextInference,
} from "./compiler/index.ts";

export {
  createBunRuntime,
  createWebStandardRuntime,
  APP_PORT,
  type Runtime,
  type ServeOptions,
} from "./runtime/index.ts";
