/**
 * AoT compiler — Sucrose analysis + `new Function()` per-route handlers.
 *
 * Generates a tailored parse/validate path that only touches context
 * properties the handler uses (dead-code elimination). Opt out with
 * {@link compileDynamic} / `aot: false` on edge runtimes that ban `eval`.
 */

import { fail } from "../kernel/errors.ts";
import { validate, type SchemaInput } from "../validation/standard-schema.ts";
import {
  assembleInput,
  HttpBodyRejected,
  parseBody,
  parseCookie,
  parseHeaders,
  parseQuery,
  type ContextInference,
} from "./http-parse.ts";
import { createInterpretedParseValidate, type CompiledParseValidate } from "./interpret.ts";
import { sucrose } from "./sucrose.ts";

export type { CompiledParseValidate, ParseValidateResult } from "./interpret.ts";
export { createInterpretedParseValidate };

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
  /** Body cap and JSON content-type policy. */
  readonly body?: import("./http-parse.ts").ParseBodyOptions;
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
  readonly body?: import("./http-parse.ts").ParseBodyOptions;
  readBody: (
    request: Request,
  ) => Promise<
    { ok: true; value: unknown } | { ok: false; failure: import("../kernel/errors.ts").FlowFailure }
  >;
  bodyFailure: (
    err: unknown,
    request: Request,
  ) => { ok: false; failure: import("../kernel/errors.ts").FlowFailure } | undefined;
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
    body: options.body,
    async readBody(request: Request) {
      try {
        return { ok: true as const, value: await parseBody(request, options.body) };
      } catch (err) {
        const rejected = this.bodyFailure(err, request);
        if (rejected) return rejected;
        throw err;
      }
    },
    bodyFailure(err, request) {
      if (!(err instanceof HttpBodyRejected)) return undefined;
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
    },
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
    lines.push("const bodyResult = await helpers.readBody(request);");
    lines.push("if (bodyResult.ok === false) return bodyResult;");
    lines.push("parts.body = bodyResult.value;");
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
 * Re-export sucrose for tests and tooling.
 */
export { sucrose } from "./sucrose.ts";
export type { SucroseOptions } from "./sucrose.ts";
export type { ContextInference } from "./http-parse.ts";
