/**
 * Interpreted parse/validate — the edge path.
 *
 * AoT (`new Function`) lives in {@link compileAot} and is loaded only when
 * requested, so eval-restricted runtimes do not carry the codegen.
 */

import type { FlowFailure } from "../kernel/errors.ts";
import { validate, type SchemaInput } from "../validation/standard-schema.ts";
import {
  assembleInput,
  extractParts,
  type ContextInference,
  type InputParts,
} from "./http-parse.ts";

/** Result of parse + validate for one request. */
export type ParseValidateResult =
  | { readonly ok: true; readonly input: unknown }
  | { readonly ok: false; readonly failure: FlowFailure };

/** Compiled parse/validate function. */
export type CompiledParseValidate = (
  request: Request,
  params: Readonly<Record<string, string>>,
) => Promise<ParseValidateResult>;

/**
 * Interpreted parse/validate using the shared HTTP helpers (AoT fallback).
 *
 * @param inference - Context flags
 * @param schema - Input schema
 */
export function createInterpretedParseValidate(
  inference: ContextInference,
  schema: SchemaInput | undefined,
): CompiledParseValidate {
  return async (request, params) => {
    const parts: InputParts = await extractParts(request, params, inference);
    const raw = assembleInput(parts);
    const result = await validate(schema, raw);
    if (!result.ok) return { ok: false, failure: result.failure };
    return { ok: true, input: result.value };
  };
}
