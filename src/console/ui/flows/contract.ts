/**
 * Dual form ⇄ JSON contract editor (console §9.2).
 *
 * Holds the full schema with constraints: enum → select, min/max → bounded
 * input, nested objects → collapsible groups, arrays → repeatable rows.
 * Validation runs locally before sending — no network round trip for errors.
 */

import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";

// Ajv CJS/ESM interop under Bun.
const Ajv = (AjvModule as unknown as { default?: typeof AjvModule }).default ??
  AjvModule;
const addFormats =
  (addFormatsModule as unknown as { default?: typeof addFormatsModule })
    .default ?? addFormatsModule;

/** Field-level validation error. */
export interface FieldError {
  /** JSON Pointer-ish path (`/seats`, `/passenger/email`). */
  readonly path: string;
  /** Human message. */
  readonly message: string;
}

/** Result of local contract validation. */
export interface ContractValidation {
  readonly ok: boolean;
  readonly errors: readonly FieldError[];
  readonly value: unknown;
}

/** Form field descriptor derived from JSON Schema. */
export interface FormField {
  readonly path: string;
  readonly name: string;
  readonly type:
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "enum"
    | "object"
    | "array"
    | "unknown";
  readonly required: boolean;
  readonly enumValues?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly description?: string;
  readonly children?: readonly FormField[];
}

const ajv = new (Ajv as unknown as new (opts: object) => {
  compile: (schema: object) => ValidateFunction;
})({
  allErrors: true,
  strict: false,
  validateSchema: false,
});
(addFormats as (a: unknown) => void)(ajv);

const validators = new WeakMap<object, ValidateFunction>();

/**
 * Compile (and cache) a validator for a schema object.
 *
 * @param schema - JSON Schema object
 */
export function compileValidator(
  schema: Record<string, unknown>,
): ValidateFunction {
  let v = validators.get(schema);
  if (!v) {
    v = ajv.compile(schema);
    validators.set(schema, v);
  }
  return v;
}

/**
 * Validate a value against a JSON Schema locally.
 *
 * @param schema - Schema object (or null → always ok)
 * @param value - Candidate value
 */
export function validateContract(
  schema: Record<string, unknown> | null | undefined,
  value: unknown,
): ContractValidation {
  if (!schema) {
    return { ok: true, errors: [], value };
  }
  const validate = compileValidator(schema);
  const ok = validate(value) as boolean;
  if (ok) return { ok: true, errors: [], value };
  const errors = (validate.errors ?? []).map(ajvErrorToField);
  return { ok: false, errors, value };
}

function ajvErrorToField(err: ErrorObject): FieldError {
  const path = err.instancePath || "/";
  return {
    path,
    message: err.message ?? "Invalid value",
  };
}

/**
 * Parse a JSON string for the dual editor. Returns errors without throwing.
 *
 * @param text - Raw JSON text
 */
export function parseJsonEditor(text: string): {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: string;
} {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Invalid JSON",
    };
  }
}

/**
 * Sync form values → JSON text (pretty-printed).
 *
 * @param value - Current value
 */
export function valueToJsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Seed a plausible example from schema constraints (console §9.2:
 * an empty first field is a failure of imagination).
 *
 * @param schema - JSON Schema object
 */
export function seedFromSchema(
  schema: Record<string, unknown> | null | undefined,
): unknown {
  if (!schema) return {};
  return seedNode(schema);
}

function seedNode(schema: Record<string, unknown>): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }
  const type = schema.type;
  if (type === "object" || (!type && schema.properties)) {
    const props = (schema.properties ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const required = new Set(
      Array.isArray(schema.required) ? (schema.required as string[]) : [],
    );
    const out: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(props)) {
      if (required.has(key) || Object.keys(props).length <= 4) {
        out[key] = seedNode(prop);
      }
    }
    return out;
  }
  if (type === "array") {
    const items = schema.items as Record<string, unknown> | undefined;
    return items ? [seedNode(items)] : [];
  }
  if (type === "integer" || type === "number") {
    if (typeof schema.minimum === "number") return schema.minimum;
    if (typeof schema.default === "number") return schema.default;
    return type === "integer" ? 1 : 1.0;
  }
  if (type === "boolean") return false;
  if (type === "string") {
    if (schema.format === "email") return "user@example.com";
    if (schema.format === "uuid") {
      return "00000000-0000-4000-8000-000000000001";
    }
    if (typeof schema.default === "string") return schema.default;
    return schema.minLength ? "x".repeat(Number(schema.minLength)) : "";
  }
  return null;
}

/**
 * Derive flat/nested form fields from a JSON Schema object.
 *
 * @param schema - Schema
 * @param basePath - Path prefix
 */
export function fieldsFromSchema(
  schema: Record<string, unknown> | null | undefined,
  basePath = "",
): FormField[] {
  if (!schema) return [];
  const type = schema.type;
  if (type === "object" || schema.properties) {
    const props = (schema.properties ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const required = new Set(
      Array.isArray(schema.required) ? (schema.required as string[]) : [],
    );
    return Object.entries(props).map(([name, prop]) => {
      const path = `${basePath}/${name}`;
      return fieldFromProp(name, path, prop, required.has(name));
    });
  }
  return [
    fieldFromProp("value", basePath || "/", schema, true),
  ];
}

function fieldFromProp(
  name: string,
  path: string,
  prop: Record<string, unknown>,
  required: boolean,
): FormField {
  if (Array.isArray(prop.enum)) {
    return {
      path,
      name,
      type: "enum",
      required,
      enumValues: prop.enum.map(String),
      description: typeof prop.description === "string" ? prop.description : undefined,
    };
  }
  const type = prop.type;
  if (type === "object" || prop.properties) {
    return {
      path,
      name,
      type: "object",
      required,
      description: typeof prop.description === "string" ? prop.description : undefined,
      children: fieldsFromSchema(prop, path),
    };
  }
  if (type === "array") {
    return {
      path,
      name,
      type: "array",
      required,
      description: typeof prop.description === "string" ? prop.description : undefined,
      children: prop.items
        ? fieldsFromSchema(prop.items as Record<string, unknown>, `${path}/0`)
        : undefined,
    };
  }
  const t =
    type === "integer" ||
    type === "number" ||
    type === "boolean" ||
    type === "string"
      ? type
      : "unknown";
  return {
    path,
    name,
    type: t,
    required,
    minimum: typeof prop.minimum === "number" ? prop.minimum : undefined,
    maximum: typeof prop.maximum === "number" ? prop.maximum : undefined,
    description: typeof prop.description === "string" ? prop.description : undefined,
  };
}

/**
 * Set a value at a JSON-pointer-like path (`/a/b`).
 *
 * @param root - Root object
 * @param path - Path
 * @param value - New value
 */
export function setAtPath(
  root: unknown,
  path: string,
  value: unknown,
): unknown {
  if (path === "" || path === "/") return value;
  const parts = path.split("/").filter(Boolean);
  const clone = structuredClone(root ?? {}) as Record<string, unknown>;
  let cursor: Record<string, unknown> = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (key === undefined) continue;
    const next = cursor[key];
    if (next === undefined || typeof next !== "object" || next === null) {
      cursor[key] = {};
    } else {
      cursor[key] = structuredClone(next) as Record<string, unknown>;
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  if (last !== undefined) cursor[last] = value;
  return clone;
}

/**
 * Get a value at a JSON-pointer-like path.
 *
 * @param root - Root
 * @param path - Path
 */
export function getAtPath(root: unknown, path: string): unknown {
  if (path === "" || path === "/") return root;
  const parts = path.split("/").filter(Boolean);
  let cursor: unknown = root;
  for (const key of parts) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

/**
 * Diff a response value against the declared output schema — missing or
 * extra fields surface as bugs (console §9.2).
 *
 * @param schema - Output schema
 * @param value - Response body
 */
export function diffAgainstSchema(
  schema: Record<string, unknown> | null | undefined,
  value: unknown,
): { readonly missing: string[]; readonly extra: string[] } {
  if (!schema || typeof value !== "object" || value === null) {
    return { missing: [], extra: [] };
  }
  const props = (schema.properties ?? {}) as Record<string, unknown>;
  const required = Array.isArray(schema.required)
    ? (schema.required as string[])
    : Object.keys(props);
  const keys = new Set(Object.keys(value as object));
  const missing = required.filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !(k in props) && Object.keys(props).length > 0);
  return { missing, extra };
}
