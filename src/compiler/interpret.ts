/**
 * Interpreted parse/validate — the edge path.
 *
 * AoT (`new Function`) lives in {@link compileAot} and is loaded only when
 * requested, so eval-restricted runtimes do not carry the codegen.
 */

import { fail, type FlowFailure } from "../kernel/errors.ts";
import { validate, type SchemaInput } from "../validation/standard-schema.ts";
import {
  assembleInput,
  extractParts,
  HttpBodyRejected,
  type ContextInference,
  type InputParts,
  type ParseBodyOptions,
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
  body?: ParseBodyOptions,
): CompiledParseValidate {
  return async (request, params) => {
    let parts: InputParts;
    try {
      parts = await extractParts(request, params, inference, { body });
    } catch (err) {
      if (!(err instanceof HttpBodyRejected)) throw err;
      if (err.code === "InvalidQuery") {
        return {
          ok: false,
          failure: fail("InvalidQuery", { reason: err.reason ?? "malformed_body" }),
        };
      }
      if (err.code === "UnsupportedMediaType") {
        return {
          ok: false,
          failure: fail("UnsupportedMediaType", {
            contentType: request.headers.get("content-type") ?? "",
          }),
        };
      }
      return { ok: false, failure: fail("PayloadTooLarge", {}) };
    }
    const raw = assembleInput(parts);
    const result = await validate(schema, raw);
    if (!result.ok) return { ok: false, failure: result.failure };
    return { ok: true, input: result.value };
  };
}
