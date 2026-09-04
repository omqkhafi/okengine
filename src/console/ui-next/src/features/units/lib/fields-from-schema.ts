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
  /** When true, column is PII-classified (Store schema pills). */
  readonly pii?: boolean;
  /** When true, column is sensitive-classified (Store schema pills). */
  readonly sensitive?: boolean;
  /** Built-in hybrid search — BM25 via `.searchable()`. */
  readonly searchable?: boolean;
  readonly searchWeight?: number;
  /** Async LSH embed via `.embed()`. */
  readonly embed?: boolean;
  readonly embedDims?: number;
  /** When true, column is a primary key (Store schema pills). */
  readonly primaryKey?: boolean;
  /** When true, column is a foreign key (declared or inferred). */
  readonly foreignKey?: boolean;
  /** When true, column is unique and not the primary key. */
  readonly unique?: boolean;
  /** Declared FK target, when present on the schema property. */
  readonly references?: { readonly table: string; readonly column?: string };
  /** Human meaning per allowed value (`oneOf` const + title). */
  readonly valueMeanings?: readonly FieldValueMeaning[];
}

/** One allowed value and its human label. */
export type FieldValueMeaning = {
  readonly value: string;
  readonly label: string;
};

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
  const flags = schemaFieldFlags(name, prop);
  const description = typeof prop.description === "string" ? prop.description : undefined;
  if (Array.isArray(prop.enum)) {
    const meanings = valueMeaningsFromProp(prop);
    return {
      path,
      name,
      type: "enum",
      required,
      enumValues: prop.enum.map(String),
      ...(description !== undefined ? { description } : {}),
      ...(meanings !== undefined ? { valueMeanings: meanings } : {}),
      ...flags,
    };
  }
  const type = prop.type;
  if (type === "object" || prop.properties) {
    return {
      path,
      name,
      type: "object",
      required,
      ...(description !== undefined ? { description } : {}),
      ...flags,
      children: fieldsFromSchema(prop, path),
    };
  }
  if (type === "array") {
    return {
      path,
      name,
      type: "array",
      required,
      ...(description !== undefined ? { description } : {}),
      ...flags,
      children: prop.items
        ? fieldsFromSchema(prop.items as Record<string, unknown>, `${path}/0`)
        : undefined,
    };
  }
  const t =
    type === "integer" || type === "number" || type === "boolean" || type === "string"
      ? type
      : "unknown";
  const meanings = valueMeaningsFromProp(prop);
  return {
    path,
    name,
    type: t,
    required,
    minimum: typeof prop.minimum === "number" ? prop.minimum : undefined,
    maximum: typeof prop.maximum === "number" ? prop.maximum : undefined,
    ...(description !== undefined ? { description } : {}),
    ...(meanings !== undefined ? { valueMeanings: meanings } : {}),
    ...flags,
  };
}

/**
 * PK / FK / unique / classification from schema keywords, then name inference.
 *
 * @param name - Property name
 * @param prop - JSON Schema property
 */
export function schemaFieldFlags(
  name: string,
  prop: Record<string, unknown>,
): Pick<FormField, "pii" | "sensitive" | "primaryKey" | "foreignKey" | "unique" | "references"> {
  const inferred = inferFieldConstraints(name);
  const references = schemaReferences(prop.references);
  const primaryKey = prop.primaryKey === true || inferred.primaryKey === true;
  const foreignKey = references !== undefined || inferred.foreignKey === true;
  const unique = !primaryKey && (prop.unique === true || inferred.unique === true);
  return {
    ...(prop.pii === true ? { pii: true } : {}),
    ...(prop.sensitive === true ? { sensitive: true } : {}),
    ...(primaryKey ? { primaryKey: true } : {}),
    ...(foreignKey ? { foreignKey: true } : {}),
    ...(unique ? { unique: true } : {}),
    ...(references !== undefined ? { references } : {}),
  };
}

/**
 * Infer PK / FK / unique from a field name when the schema omitted keywords.
 *
 * @param name - Property name (`id`, `userId`, `teamKey`, `identifier`)
 */
export function inferFieldConstraints(
  name: string,
): Pick<FormField, "primaryKey" | "foreignKey" | "unique"> {
  if (name === "id") return { primaryKey: true };
  if (/(?:Id|_id)$/.test(name)) return { foreignKey: true };
  if (/(?:Key|_key)$/.test(name) && name !== "key") return { foreignKey: true };
  if (name === "identifier" || name === "key") return { unique: true };
  return {};
}

function schemaReferences(
  value: unknown,
): { readonly table: string; readonly column?: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const table = "table" in value && typeof value.table === "string" ? value.table : undefined;
  if (!table) return undefined;
  const column = "column" in value && typeof value.column === "string" ? value.column : undefined;
  return column !== undefined ? { table, column } : { table };
}

/** Max inclusive integers we'll expand into a Call API select. */
const INTEGER_SELECT_SPAN = 12;

/**
 * Human constraint for a field (`0–4`, `≥ 1`, enum list).
 *
 * @param field - Form field
 */
export function fieldConstraintHint(field: FormField): string | null {
  if (field.enumValues && field.enumValues.length > 0) return field.enumValues.join(" · ");
  if (field.minimum !== undefined && field.maximum !== undefined) {
    return `${field.minimum}–${field.maximum}`;
  }
  if (field.minimum !== undefined) return `≥ ${field.minimum}`;
  if (field.maximum !== undefined) return `≤ ${field.maximum}`;
  return null;
}

/**
 * Sentence for a closed or open numeric range.
 *
 * @param field - Form field
 */
export function fieldRangeSentence(field: FormField): string | null {
  if (field.minimum !== undefined && field.maximum !== undefined) {
    return `Must be from ${field.minimum} up to ${field.maximum}.`;
  }
  if (field.minimum !== undefined) return `Must be at least ${field.minimum}.`;
  if (field.maximum !== undefined) return `Must be at most ${field.maximum}.`;
  return null;
}

/**
 * Fields that declare a range, enum, or labeled values.
 *
 * @param fields - Contract fields
 */
export function fieldsWithValidation(fields: readonly FormField[]): FormField[] {
  return fields.filter(
    (f) =>
      f.minimum !== undefined ||
      f.maximum !== undefined ||
      (f.enumValues?.length ?? 0) > 0 ||
      (f.valueMeanings?.length ?? 0) > 0,
  );
}

function valueMeaningsFromProp(
  prop: Record<string, unknown>,
): readonly FieldValueMeaning[] | undefined {
  const variants = Array.isArray(prop.oneOf)
    ? prop.oneOf
    : Array.isArray(prop.anyOf)
      ? prop.anyOf
      : null;
  if (variants) {
    const out: FieldValueMeaning[] = [];
    for (const raw of variants) {
      if (!raw || typeof raw !== "object") continue;
      const node = raw as Record<string, unknown>;
      if (!("const" in node)) continue;
      const value = String(node.const);
      const label =
        typeof node.title === "string"
          ? node.title
          : typeof node.description === "string"
            ? node.description
            : undefined;
      if (label) out.push({ value, label });
    }
    return out.length > 0 ? out : undefined;
  }
  return undefined;
}

/**
 * Discrete integer options when min/max is a small closed range.
 *
 * @param field - Form field
 */
export function integerSelectValues(field: FormField): readonly number[] | null {
  if (field.type !== "integer") return null;
  if (field.minimum === undefined || field.maximum === undefined) return null;
  if (!Number.isInteger(field.minimum) || !Number.isInteger(field.maximum)) return null;
  const span = field.maximum - field.minimum;
  if (span < 0 || span > INTEGER_SELECT_SPAN) return null;
  return Array.from({ length: span + 1 }, (_, i) => field.minimum! + i);
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
      if (required.has(key) || "default" in prop || Object.keys(props).length <= 4) {
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
    if (typeof schema.default === "number") return schema.default;
    if (typeof schema.minimum === "number") return schema.minimum;
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
