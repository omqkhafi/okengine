/**
 * Lightweight JSON Schema validation for Units Call API body forms.
 *
 * Avoids bundling Ajv into the SPA — checks required object fields + basic types.
 */

/** Field-level validation error. */
export interface FieldError {
  readonly path: string;
  readonly message: string;
}

/** Result of local contract validation. */
export interface ContractValidation {
  readonly ok: boolean;
  readonly errors: readonly FieldError[];
  readonly value: unknown;
}

/**
 * Validate a value against a JSON Schema object (required + primitive types).
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
  const errors: FieldError[] = [];
  validateNode(schema, value, "", errors);
  return { ok: errors.length === 0, errors, value };
}

function validateNode(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
  errors: FieldError[],
): void {
  const type = schema.type;
  if (type === "object" || schema.properties) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      errors.push({ path: path || "/", message: "must be object" });
      return;
    }
    const obj = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    for (const key of required) {
      if (obj[key] === undefined || obj[key] === null || obj[key] === "") {
        errors.push({ path: `${path}/${key}`, message: "required" });
      }
    }
    for (const [key, prop] of Object.entries(props)) {
      if (obj[key] === undefined) continue;
      validateNode(prop, obj[key], `${path}/${key}`, errors);
    }
    return;
  }
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.map(String).includes(String(value))) {
      errors.push({ path: path || "/", message: "invalid enum" });
    }
    return;
  }
  if (type === "string" && typeof value !== "string") {
    errors.push({ path: path || "/", message: "must be string" });
  } else if (type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      errors.push({ path: path || "/", message: "must be integer" });
    } else {
      pushRangeError(schema, value, path, errors);
    }
  } else if (type === "number") {
    if (typeof value !== "number" || Number.isNaN(value)) {
      errors.push({ path: path || "/", message: "must be number" });
    } else {
      pushRangeError(schema, value, path, errors);
    }
  } else if (type === "boolean" && typeof value !== "boolean") {
    errors.push({ path: path || "/", message: "must be boolean" });
  }
}

function pushRangeError(
  schema: Record<string, unknown>,
  value: number,
  path: string,
  errors: FieldError[],
): void {
  const min = typeof schema.minimum === "number" ? schema.minimum : undefined;
  const max = typeof schema.maximum === "number" ? schema.maximum : undefined;
  if (min !== undefined && value < min) {
    errors.push({ path: path || "/", message: `must be ≥ ${min}` });
  }
  if (max !== undefined && value > max) {
    errors.push({ path: path || "/", message: `must be ≤ ${max}` });
  }
}
