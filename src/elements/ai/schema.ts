/**
 * Prompt output schema validation — distinct from provider errors.
 *
 * The model answered; the shape was wrong. This rate is the metric that
 * rises first when a prompt regresses (console §9.10).
 */

/** Structured mismatch between a model answer and the declared `out` schema. */
export interface AiSchemaMismatch {
  readonly missing: readonly string[];
  readonly extra: readonly string[];
  readonly typeMismatches: readonly string[];
}

/**
 * Error raised when a model returns a payload that fails the prompt's
 * declared output schema. Distinct from a provider / transport failure.
 */
export class AiSchemaValidationError extends Error {
  readonly code = "AiSchemaInvalid" as const;
  readonly prompt: string;
  readonly version: number | undefined;
  readonly mismatch: AiSchemaMismatch;
  readonly raw: unknown;

  /**
   * @param prompt - Prompt name
   * @param version - Prompt version
   * @param mismatch - Field-level mismatches
   * @param raw - Raw model payload
   */
  constructor(
    prompt: string,
    version: number | undefined,
    mismatch: AiSchemaMismatch,
    raw: unknown,
  ) {
    const parts: string[] = [];
    if (mismatch.missing.length > 0) {
      parts.push(`missing [${mismatch.missing.join(", ")}]`);
    }
    if (mismatch.extra.length > 0) {
      parts.push(`extra [${mismatch.extra.join(", ")}]`);
    }
    if (mismatch.typeMismatches.length > 0) {
      parts.push(`types [${mismatch.typeMismatches.join(", ")}]`);
    }
    super(
      `ai: schema validation failed for prompt "${prompt}"` +
        (version !== undefined ? `@${version}` : "") +
        (parts.length > 0 ? `: ${parts.join("; ")}` : ""),
    );
    this.name = "AiSchemaValidationError";
    this.prompt = prompt;
    this.version = version;
    this.mismatch = mismatch;
    this.raw = raw;
  }
}

/**
 * Whether a value is a JSON-schema-like object with `properties`.
 *
 * @param schema - Declared `out`
 */
export function isObjectSchema(
  schema: unknown,
): schema is {
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly type?: string;
} {
  return (
    schema !== null &&
    typeof schema === "object" &&
    !Array.isArray(schema) &&
    ("properties" in schema || "required" in schema || "type" in schema)
  );
}

/**
 * Coerce a model completion into a plain object (pre-validation).
 *
 * @param value - Raw completion
 */
export function coerceModelObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { text: value };
    }
    return { text: value };
  }
  return { value };
}

/**
 * Diff a payload against a JSON-schema-like `out` declaration.
 *
 * @param schema - Declared output schema
 * @param value - Coerced object
 */
export function matchOutSchema(
  schema: unknown,
  value: Record<string, unknown>,
): AiSchemaMismatch | null {
  if (!isObjectSchema(schema)) return null;

  const props = (schema.properties ?? {}) as Record<string, unknown>;
  const required = Array.isArray(schema.required)
    ? [...schema.required]
    : Object.keys(props);
  const keys = new Set(Object.keys(value));
  const missing = required.filter((k) => !keys.has(k));
  const extra =
    Object.keys(props).length > 0
      ? [...keys].filter((k) => !(k in props))
      : [];
  const typeMismatches: string[] = [];
  for (const [key, propSchema] of Object.entries(props)) {
    if (!(key in value)) continue;
    const expected =
      propSchema &&
      typeof propSchema === "object" &&
      !Array.isArray(propSchema) &&
      "type" in propSchema
        ? String((propSchema as { type?: unknown }).type)
        : undefined;
    if (!expected) continue;
    const actual = value[key];
    if (!matchesJsonType(actual, expected)) {
      typeMismatches.push(`${key}:expected ${expected}`);
    }
  }

  if (
    missing.length === 0 &&
    extra.length === 0 &&
    typeMismatches.length === 0
  ) {
    return null;
  }
  return { missing, extra, typeMismatches };
}

/**
 * Validate a model payload against `out`. Returns the object or throws
 * {@link AiSchemaValidationError}.
 *
 * @param prompt - Prompt name
 * @param version - Prompt version
 * @param schema - Declared `out`
 * @param raw - Raw model payload
 */
export function validatePromptOut(
  prompt: string,
  version: number | undefined,
  schema: unknown,
  raw: unknown,
): Record<string, unknown> {
  const object = coerceModelObject(raw);
  const mismatch = matchOutSchema(schema, object);
  if (mismatch) {
    throw new AiSchemaValidationError(prompt, version, mismatch, raw);
  }
  return object;
}

function matchesJsonType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
    case "integer":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}
