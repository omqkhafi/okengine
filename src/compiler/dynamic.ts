/**
 * Dynamic (`aot: false`) parse/validate path.
 *
 * Always materialises the full request context — no `new Function()`, no
 * dead-code elimination. Required on eval-restricted runtimes (the
 * documented Cloudflare / edge pain that makes AoT an optimisation, never
 * a requirement). Produces byte-identical responses to {@link compileAot}.
 */

import type { SchemaInput } from "../validation/standard-schema.ts";
import {
  compileAot,
  createInterpretedParseValidate,
  type CompiledRoute,
  type CompileRouteOptions,
} from "./aot.ts";
import { FULL_INFERENCE } from "./http-parse.ts";
import { dynamicInference } from "./sucrose.ts";

/**
 * Compile a route with the dynamic fallback (full context every request).
 *
 * @param options - Route metadata
 */
export function compileDynamic(options: CompileRouteOptions): CompiledRoute {
  const inference = dynamicInference();
  return {
    inference,
    parseValidate: createInterpretedParseValidate(inference, options.schema),
    aot: false,
  };
}

/**
 * Compile with AoT when `aot` is true (default), else dynamic.
 *
 * @param options - Route metadata
 * @param aot - When `false`, force the dynamic path
 */
export function compileRoute(
  options: CompileRouteOptions,
  aot: boolean = true,
): CompiledRoute {
  if (!aot) return compileDynamic(options);
  return compileAot(options);
}

/**
 * Full inference constant (tests / diagnostics).
 */
export { FULL_INFERENCE };

/** @internal re-export schema type for consumers */
export type { SchemaInput };
