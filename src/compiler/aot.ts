/**
 * AoT compiler — Sucrose analysis + `new Function()` per-route handlers.
 *
 * Generates a tailored parse/validate path that only touches context
 * properties the handler uses (dead-code elimination). Opt out with
 * {@link compileDynamic} / `aot: false` on edge runtimes that ban `eval`.
 */

import type { FlowFailure } from "../kernel/errors.ts";
import { validate, type SchemaInput } from "../validation/standard-schema.ts";
import {
  assembleInput,
  extractParts,
  parseBody,
  parseCookie,
  parseHeaders,
  parseQuery,
  type ContextInference,
  type InputParts,
} from "./http-parse.ts";
import { sucrose } from "./sucrose.ts";

/** Result of parse + validate for one request. */
export type ParseValidateResult =
  | { readonly ok: true; readonly input: unknown }
  | { readonly ok: false; readonly failure: FlowFailure };

/** Compiled parse/validate function. */
export type CompiledParseValidate = (
  request: Request,
  params: Readonly<Record<string, string>>,
) => Promise<ParseValidateResult>;

/** Options for {@link compileAot}. */
export interface CompileRouteOptions {
  /** HTTP method. */
  readonly method: string;
  /** HTTP path pattern. */
  readonly path: string;
  /** Flow handler (`do`). */
  readonly handler: (...args: never[]) => unknown;
  /** Optional lifecycle hooks included in sucrose. */
  readonly hooks?: ReadonlyArray<(...args: never[]) => unknown>;
  /** Input schema (Standard Schema when present). */
  readonly schema?: SchemaInput | undefined;
}

/** Bundle returned by the compilers. */
export interface CompiledRoute {
  /** Inference used to generate / drive the handler. */
  readonly inference: ContextInference;
  /** Parse + validate only. */
  readonly parseValidate: CompiledParseValidate;
  /** `true` when generated via `new Function`. */
  readonly aot: boolean;
}

/** Helpers injected into generated AoT functions. */
interface AotHelpers {
  readonly inference: ContextInference;
  readonly schema: SchemaInput | undefined;
  parseBody: typeof parseBody;
  parseQuery: typeof parseQuery;
  parseHeaders: typeof parseHeaders;
  parseCookie: typeof parseCookie;
  assembleInput: typeof assembleInput;
  validate: typeof validate;
}

/**
 * Compile a minimal per-route parse/validate handler via `new Function()`.
 *
 * Falls back to the interpreted path when codegen is unavailable.
 *
 * @param options - Route metadata
 */
export function compileAot(options: CompileRouteOptions): CompiledRoute {
  const inference = sucrose({
    handler: options.handler,
    hooks: options.hooks,
    path: options.path,
    method: options.method,
    hasSchema: options.schema !== undefined && options.schema !== null,
  });

  const helpers: AotHelpers = {
    inference,
    schema: options.schema,
    parseBody,
    parseQuery,
    parseHeaders,
    parseCookie,
    assembleInput,
    validate,
  };

  try {
    const parseValidate = generateParseValidate(inference, helpers);
    return { inference, parseValidate, aot: true };
  } catch {
    return {
      inference,
      parseValidate: createInterpretedParseValidate(inference, options.schema),
      aot: false,
    };
  }
}

/**
 * Generate a tailored async function that only parses inferred slots.
 *
 * @param inference - Context flags
 * @param helpers - Bound runtime helpers
 */
function generateParseValidate(
  inference: ContextInference,
  helpers: AotHelpers,
): CompiledParseValidate {
  const lines: string[] = [];
  lines.push("const parts = {};");

  if (inference.params) {
    lines.push("parts.params = Object.assign({}, params);");
  }
  if (inference.query) {
    lines.push("parts.query = helpers.parseQuery(request);");
  }
  if (inference.headers) {
    lines.push("parts.headers = helpers.parseHeaders(request);");
  }
  if (inference.cookie) {
    lines.push("parts.cookie = helpers.parseCookie(request);");
  }
  if (inference.body) {
    lines.push("parts.body = await helpers.parseBody(request);");
  }

  lines.push("const raw = helpers.assembleInput(parts);");
  lines.push("if (helpers.schema === undefined || helpers.schema === null) {");
  lines.push("  return { ok: true, input: raw };");
  lines.push("}");
  lines.push("const result = await helpers.validate(helpers.schema, raw);");
  lines.push("if (!result.ok) return { ok: false, failure: result.failure };");
  lines.push("return { ok: true, input: result.value };");

  // new Function — the Bun/Node optimisation; banned on some edge runtimes
  const factory = new Function(
    "helpers",
    `"use strict";\nreturn async function parseValidate(request, params) {\n${lines.map((l) => `  ${l}`).join("\n")}\n};`,
  ) as (helpers: AotHelpers) => CompiledParseValidate;

  return factory(helpers);
}

/**
 * Interpreted parse/validate using the same helpers (AoT fallback).
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

/**
 * Re-export sucrose for tests and tooling.
 */
export { sucrose } from "./sucrose.ts";
export type { SucroseOptions } from "./sucrose.ts";
export type { ContextInference } from "./http-parse.ts";
