/**
 * Standard Schema V1 integration (unified-theory §13).
 *
 * Accept Zod 4, Valibot, ArkType, and TypeBox (via {@link fromTypeBox}).
 * Validation failures are typed flow-boundary errors — never thrown exceptions.
 */

import { fail, type FlowFailure } from "../kernel/errors.ts";

// ---------------------------------------------------------------------------
// Standard Schema V1 (https://standardschema.dev/)
// ---------------------------------------------------------------------------

/** The Standard Typed interface — base for Standard Schema. */
export interface StandardTypedV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardTypedV1.Props<Input, Output>;
}

export declare namespace StandardTypedV1 {
  /** Standard Typed properties. */
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: Types<Input, Output> | undefined;
  }

  /** Inferred input/output types carrier. */
  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }

  /** Infer input type from a Standard Typed schema. */
  export type InferInput<Schema extends StandardTypedV1> = NonNullable<
    Schema["~standard"]["types"]
  >["input"];

  /** Infer output type from a Standard Typed schema. */
  export type InferOutput<Schema extends StandardTypedV1> = NonNullable<
    Schema["~standard"]["types"]
  >["output"];
}

/** The Standard Schema interface. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
  /** Standard Schema properties. */
  export interface Props<Input = unknown, Output = Input> extends StandardTypedV1.Props<
    Input,
    Output
  > {
    readonly validate: (
      value: unknown,
      options?: Options | undefined,
    ) => Result<Output> | Promise<Result<Output>>;
  }

  /** Optional validate options. */
  export interface Options {
    readonly libraryOptions?: Record<string, unknown> | undefined;
  }

  /** Validate result. */
  export type Result<Output> = SuccessResult<Output> | FailureResult;

  /** Successful validation. */
  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }

  /** Failed validation. */
  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }

  /** One validation issue. */
  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }

  /** Path segment object form. */
  export interface PathSegment {
    readonly key: PropertyKey;
  }

  /** Infer input. */
  export type InferInput<Schema extends StandardTypedV1> = StandardTypedV1.InferInput<Schema>;

  /** Infer output. */
  export type InferOutput<Schema extends StandardTypedV1> = StandardTypedV1.InferOutput<Schema>;
}

/** Accept a Standard Schema or any other schema-shaped value. */
export type SchemaInput = StandardSchemaV1 | unknown;

/** Built-in error code for contract validation failures. */
export const VALIDATION_ERROR_CODE = "ValidationError" as const;

/** Normalized issue returned in {@link ValidationErrorData}. */
export interface ValidationIssue {
  readonly message: string;
  readonly path: ReadonlyArray<string | number>;
}

/** Payload for `ValidationError`. */
export interface ValidationErrorData {
  readonly issues: ReadonlyArray<ValidationIssue>;
}

/** Outcome of {@link validate}. */
export type ValidateResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: FlowFailure<ValidationErrorData> };

/**
 * Type guard for Standard Schema V1.
 *
 * @param value - Unknown value
 */
export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  // ArkType schemas are callable functions that still carry `~standard`.
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return false;
  }
  const standard = (value as StandardSchemaV1)["~standard"];
  return (
    typeof standard === "object" &&
    standard !== null &&
    standard.version === 1 &&
    typeof standard.validate === "function"
  );
}

/**
 * Infer output type of a schema input (unknown when not a Standard Schema).
 */
export type InferSchemaOutput<S> = S extends StandardSchemaV1<infer _I, infer O> ? O : unknown;

/**
 * Infer input type of a schema input.
 */
export type InferSchemaInput<S> = S extends StandardSchemaV1<infer I, infer _O> ? I : unknown;

/**
 * Normalize a Standard Schema issue path to JSON-stable keys.
 *
 * @param path - Spec path array
 */
export function normalizeIssuePath(path: StandardSchemaV1.Issue["path"]): Array<string | number> {
  if (!path) return [];
  const out: Array<string | number> = [];
  for (const segment of path) {
    if (typeof segment === "object" && segment !== null && "key" in segment) {
      const key = (segment as StandardSchemaV1.PathSegment).key;
      if (typeof key === "string" || typeof key === "number") out.push(key);
      else out.push(String(key));
    } else if (typeof segment === "string" || typeof segment === "number") {
      out.push(segment);
    } else {
      out.push(String(segment));
    }
  }
  return out;
}

/**
 * Build a typed `ValidationError` flow failure (does not throw).
 *
 * @param issues - Standard Schema issues
 */
export function validationFailure(
  issues: ReadonlyArray<StandardSchemaV1.Issue>,
): FlowFailure<ValidationErrorData> {
  const normalized: ValidationIssue[] = issues.map((issue) => ({
    message: issue.message,
    path: normalizeIssuePath(issue.path),
  }));
  return fail(VALIDATION_ERROR_CODE, { issues: normalized });
}

/**
 * Validate `value` against a Standard Schema. Never throws.
 *
 * Non-schemas pass through unchanged (`ok: true`).
 *
 * @param schema - Schema or unknown
 * @param value - Raw input
 */
export async function validate<T = unknown>(
  schema: SchemaInput | undefined,
  value: unknown,
): Promise<ValidateResult<T>> {
  if (schema === undefined || schema === null) {
    return { ok: true, value: value as T };
  }
  if (!isStandardSchema(schema)) {
    return { ok: true, value: value as T };
  }
  const result = await schema["~standard"].validate(value);
  if (result.issues) {
    return { ok: false, failure: validationFailure(result.issues) };
  }
  return { ok: true, value: result.value as T };
}

/**
 * Synchronous validate when the schema's validate is sync; otherwise
 * returns a Promise. Prefer {@link validate} at call sites.
 *
 * @param schema - Schema or unknown
 * @param value - Raw input
 */
export function validateSync<T = unknown>(
  schema: SchemaInput | undefined,
  value: unknown,
): ValidateResult<T> | Promise<ValidateResult<T>> {
  if (schema === undefined || schema === null || !isStandardSchema(schema)) {
    return { ok: true, value: value as T };
  }
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) {
    return result.then((r) => {
      if (r.issues) return { ok: false, failure: validationFailure(r.issues) };
      return { ok: true, value: r.value as T };
    });
  }
  if (result.issues) {
    return { ok: false, failure: validationFailure(result.issues) };
  }
  return { ok: true, value: result.value as T };
}

/** Minimal TypeBox schematic duck-type (keeps TypeBox optional). */
export interface TypeBoxSchema {
  readonly type?: string;
  readonly properties?: unknown;
  readonly required?: readonly string[];
}

/** TypeBox Value module surface used by {@link fromTypeBox}. */
export interface TypeBoxValueApi {
  Check(schema: unknown, value: unknown): boolean;
  Errors(
    schema: unknown,
    value: unknown,
  ): Iterable<{ readonly message: string; readonly path: string }>;
  Parse?<T>(schema: unknown, value: unknown): T;
}

/**
 * Wrap a TypeBox schematic as Standard Schema V1.
 *
 * TypeBox does not attach `~standard` to schematics (separation of schema
 * and validator). Pass `Value` from `@sinclair/typebox/value`.
 *
 * @param schema - TypeBox `TSchema`
 * @param valueApi - `import { Value } from "@sinclair/typebox/value"`
 */
export function fromTypeBox<T = unknown>(
  schema: TypeBoxSchema | unknown,
  valueApi: TypeBoxValueApi,
): StandardSchemaV1<T, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "typebox",
      validate(value) {
        if (valueApi.Check(schema, value)) {
          const parsed =
            valueApi.Parse !== undefined ? valueApi.Parse<T>(schema, value) : (value as T);
          return { value: parsed };
        }
        const issues: StandardSchemaV1.Issue[] = [];
        for (const err of valueApi.Errors(schema, value)) {
          const path = err.path
            .split("/")
            .filter((p) => p.length > 0)
            .map((p) => {
              const n = Number(p);
              return Number.isInteger(n) && String(n) === p ? n : p;
            });
          issues.push({ message: err.message, path });
        }
        if (issues.length === 0) {
          issues.push({ message: "Invalid value", path: [] });
        }
        return { issues };
      },
    },
  };
}
