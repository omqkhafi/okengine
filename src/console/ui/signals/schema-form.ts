/**
 * Render a signal payload as an editable form from the declared schema.
 */

/** One field derived from a JSON-schema-like object. */
export interface SchemaField {
  readonly key: string;
  readonly type: "string" | "number" | "boolean" | "integer" | "unknown";
  readonly required: boolean;
  readonly enumValues?: readonly string[];
}

/**
 * Extract editable fields from a signal's declared schema.
 *
 * @param schema - Manifest / Standard Schema object form
 */
export function fieldsFromSchema(schema: unknown): readonly SchemaField[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return [];
  }
  const obj = schema as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: unknown;
  };
  if (obj.type !== "object" || !obj.properties) return [];
  const required = new Set(
    Array.isArray(obj.required)
      ? obj.required.filter((k): k is string => typeof k === "string")
      : [],
  );
  return Object.entries(obj.properties).map(([key, def]) => {
    const d = (def ?? {}) as {
      type?: string;
      enum?: unknown[];
    };
    const enumValues = Array.isArray(d.enum)
      ? d.enum.filter((v): v is string => typeof v === "string")
      : undefined;
    const type =
      d.type === "string" ||
      d.type === "number" ||
      d.type === "boolean" ||
      d.type === "integer"
        ? d.type
        : "unknown";
    return {
      key,
      type,
      required: required.has(key),
      ...(enumValues && enumValues.length > 0 ? { enumValues } : {}),
    };
  });
}

/**
 * Coerce a payload object into string form values for controlled inputs.
 *
 * @param payload - Dead-letter payload
 * @param fields - Schema fields
 */
export function payloadToFormValues(
  payload: unknown,
  fields: readonly SchemaField[],
): Record<string, string> {
  const src =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = src[f.key];
    if (v === undefined || v === null) out[f.key] = "";
    else if (typeof v === "boolean") out[f.key] = v ? "true" : "false";
    else out[f.key] = String(v);
  }
  if (fields.length === 0) {
    out._raw = JSON.stringify(payload ?? null, null, 2);
  }
  return out;
}

/**
 * Parse form values back into a payload object.
 *
 * @param values - Form strings
 * @param fields - Schema fields
 */
export function formValuesToPayload(
  values: Record<string, string>,
  fields: readonly SchemaField[],
): unknown {
  if (fields.length === 0) {
    try {
      return JSON.parse(values._raw ?? "null") as unknown;
    } catch {
      return values._raw ?? null;
    }
  }
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = values[f.key] ?? "";
    if (raw === "" && !f.required) continue;
    if (f.type === "boolean") out[f.key] = raw === "true";
    else if (f.type === "number" || f.type === "integer") {
      const n = Number(raw);
      out[f.key] = Number.isFinite(n) ? n : raw;
    } else out[f.key] = raw;
  }
  return out;
}
