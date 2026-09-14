/**
 * Project a Flow success value onto the exposure `out` schema.
 *
 * Store rows carry `Date` timestamps (or epoch-ms from `fx.clock.now()`);
 * HTTP `out` is usually ISO-8601. Direct Standard Schema parse keeps
 * `z.date()` replies as dates. When that fails, JSON-wire (`Date` → ISO,
 * `*At` / `*_at` / `at` epoch-ms → ISO) and parse again so
 * `fx.json.create(row)` matches `out` without a hand-written DTO mapper.
 * Extra keys strip when parse succeeds. Parse failure is not a client
 * error — `out` is a projector, not a hard gate.
 */

import type { SchemaInput } from "../validation/standard-schema.ts";
import { validate } from "../validation/standard-schema.ts";
import { isJsonResult, isJsonStreamResult, jsonResultBrand, type JsonResult } from "./fx.ts";

/**
 * Project `output` through `schema` when the exposure declared `out`.
 *
 * JsonResult carriers project `.value` (status / meta stay). Streams, 204,
 * and missing schema pass through.
 *
 * @param schema - Flow `out` (Standard Schema or unknown)
 * @param output - Handler return
 */
export async function projectFlowOut(
  schema: SchemaInput | undefined,
  output: unknown,
): Promise<unknown> {
  if (schema === undefined || schema === null) return output;
  if (output === undefined) return output;
  if (isJsonStreamResult(output)) return output;
  if (isJsonResult(output)) {
    if (output.status === 204 || output.value === undefined) return output;
    const value = await projectValue(schema, output.value);
    if (value === output.value) return output;
    return {
      [jsonResultBrand]: true,
      status: output.status,
      value,
      ...(output.meta !== undefined ? { meta: output.meta } : {}),
    } as JsonResult;
  }
  return projectValue(schema, output);
}

/**
 * Parse `value` as `schema`. On miss, JSON-wire then parse (Date / epoch-ms → ISO).
 *
 * @param schema - Success reply schema
 * @param value - Raw handler / store value
 */
async function projectValue(schema: SchemaInput, value: unknown): Promise<unknown> {
  const direct = await validate(schema, value);
  if (direct.ok) return direct.value;
  const wired = jsonWire(value);
  if (wired === value) return value;
  const second = await validate(schema, wired);
  return second.ok ? second.value : value;
}

/**
 * Whether a JSON key looks like a temporal field (`createdAt`, `expires_at`, `at`).
 *
 * @param key - Property name from {@link JSON.stringify} replacer
 */
function isTemporalKey(key: string): boolean {
  return key === "at" || key.endsWith("At") || key.endsWith("_at");
}

/**
 * JSON round-trip so `Date` and temporal epoch-ms become ISO-8601
 * (same bytes `Response.json` emits for dates).
 *
 * @param value - Arbitrary success payload
 */
function jsonWire(value: unknown): unknown {
  try {
    return JSON.parse(
      JSON.stringify(value, (key, item) => {
        if (typeof item === "bigint") return Number(item);
        if (typeof item === "number" && Number.isFinite(item) && isTemporalKey(key)) {
          return new Date(item).toISOString();
        }
        return item;
      }),
    );
  } catch {
    return value;
  }
}
