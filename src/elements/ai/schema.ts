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
export function isObjectSchema(schema: unknown): schema is {
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
    const fromEnvelope = textFromChatEnvelope(value);
    if (fromEnvelope !== undefined) return coerceModelObject(fromEnvelope);
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    const parsed = parseJsonObject(value);
    return parsed ?? { text: value };
  }
  return { value };
}

/**
 * Normalize a prompt `out` (Zod, JSON Schema, or `{ field: "string" }`
 * shorthand) into a JSON Schema object for validation and `response_format`.
 *
 * @param out - Declared prompt output
 */
export function promptOutJsonSchema(out: unknown): Record<string, unknown> | undefined {
  if (out == null || typeof out !== "object" || Array.isArray(out)) return undefined;
  if (hasToJSONSchema(out)) {
    try {
      const json = out.toJSONSchema();
      if (isObjectSchema(json) && json.properties) return json as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  if (isObjectSchema(out) && out.properties) return out as Record<string, unknown>;
  const shorthand = shorthandProperties(out);
  if (shorthand) {
    return { type: "object", properties: shorthand, required: Object.keys(shorthand) };
  }
  return undefined;
}

/**
 * Driver `response_format` for a declared `out` — JSON Schema wrapper.
 * OpenAI-compatible wires this as `json_object` (llama.cpp granite empties
 * `content` on `json_schema`).
 *
 * @param prompt - Prompt name (schema id)
 * @param out - Declared output
 */
export function promptResponseFormat(
  prompt: string,
  out: unknown,
): { readonly type: "json_schema"; readonly json_schema: Record<string, unknown> } | undefined {
  const schema = promptOutJsonSchema(out);
  if (!schema) return undefined;
  const name = prompt.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "out";
  return {
    type: "json_schema",
    json_schema: { name, schema, strict: true },
  };
}

/**
 * Deterministic object that satisfies a JSON Schema's required properties.
 *
 * @param schema - JSON Schema object
 */
export function fixtureFromJsonSchema(schema: unknown): Record<string, unknown> | undefined {
  const json = promptOutJsonSchema(schema) ?? (isObjectSchema(schema) ? schema : undefined);
  if (!json?.properties || typeof json.properties !== "object") return undefined;
  const props = json.properties as Record<string, unknown>;
  const required = Array.isArray(json.required) ? json.required : Object.keys(props);
  const out: Record<string, unknown> = {};
  for (const key of required) {
    if (typeof key !== "string" || !(key in props)) continue;
    out[key] = fixtureValue(props[key]);
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
  const resolved = promptOutJsonSchema(schema) ?? schema;
  if (!isObjectSchema(resolved)) return null;

  const props = (resolved.properties ?? {}) as Record<string, unknown>;
  const required = Array.isArray(resolved.required) ? [...resolved.required] : Object.keys(props);
  const keys = new Set(Object.keys(value));
  const missing = required.filter((k) => !keys.has(k));
  const extra =
    Object.keys(props).length > 0 ? [...keys].filter((k) => k !== "via" && !(k in props)) : [];
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

  if (missing.length === 0 && extra.length === 0 && typeMismatches.length === 0) {
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

function hasToJSONSchema(value: object): value is { toJSONSchema: () => unknown } {
  return (
    "toJSONSchema" in value &&
    typeof (value as { toJSONSchema?: unknown }).toJSONSchema === "function"
  );
}

function shorthandProperties(out: object): Record<string, { type: string }> | undefined {
  const entries = Object.entries(out);
  if (entries.length === 0) return undefined;
  if (hasToJSONSchema(out) || isObjectSchema(out)) return undefined;
  const properties: Record<string, { type: string }> = {};
  for (const [key, value] of entries) {
    if (typeof value !== "string") return undefined;
    properties[key] = { type: value };
  }
  return properties;
}

function textFromChatEnvelope(value: object): string | undefined {
  if (!("choices" in value) || !Array.isArray((value as { choices?: unknown }).choices)) {
    return undefined;
  }
  const choice = (value as { choices: unknown[] }).choices[0];
  if (!choice || typeof choice !== "object") return undefined;
  const message = (choice as { message?: { content?: unknown; reasoning_content?: unknown } })
    .message;
  if (!message) return undefined;
  if (typeof message.content === "string" && message.content.trim().length > 0) {
    return message.content;
  }
  if (
    typeof message.reasoning_content === "string" &&
    message.reasoning_content.trim().length > 0
  ) {
    return message.reasoning_content;
  }
  return undefined;
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) candidates.unshift(fenced[1].trim());
  const braced = /\{[\s\S]*\}/.exec(trimmed);
  if (braced?.[0] && braced[0] !== trimmed) candidates.push(braced[0]);
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next candidate
    }
  }
  return undefined;
}

function fixtureValue(propSchema: unknown): unknown {
  const type =
    propSchema &&
    typeof propSchema === "object" &&
    !Array.isArray(propSchema) &&
    "type" in propSchema
      ? String((propSchema as { type?: unknown }).type)
      : "string";
  switch (type) {
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return true;
    case "array":
      return [];
    case "object":
      return {};
    case "null":
      return null;
    default:
      return "ok";
  }
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
