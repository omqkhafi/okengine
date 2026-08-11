/**
 * JSON Schema → form field descriptors (ported from legacy console contract).
 */

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
    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
    return Object.entries(props).map(([name, prop]) => {
      const path = `${basePath}/${name}`;
      return fieldFromProp(name, path, prop, required.has(name));
    });
  }
  return [fieldFromProp("value", basePath || "/", schema, true)];
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
    type === "integer" || type === "number" || type === "boolean" || type === "string"
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
 * Seed a plausible example from schema constraints.
 *
 * @param schema - JSON Schema object
 */
export function seedFromSchema(schema: Record<string, unknown> | null | undefined): unknown {
  if (!schema) return {};
  return seedNode(schema);
}

function seedNode(schema: Record<string, unknown>): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }
  const type = schema.type;
  if (type === "object" || (!type && schema.properties)) {
    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
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
 * Coerce Manifest `JsonSchema` to an object, or null when opaque / missing.
 *
 * @param schema - Manifest in/out value
 */
export function schemaObject(
  schema: string | Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!schema || typeof schema === "string") return null;
  return schema;
}
