/**
 * Split flow input into query/path parameters vs body / filter fields.
 */

import { httpMethodHasBody } from "@/features/flows/traces/http-method.ts";
import type { FormField } from "./fields-from-schema.ts";

/** List / page / sort keys — query parameters, not resource fields. */
const PARAM_NAMES = new Set([
  "q",
  "query",
  "search",
  "limit",
  "offset",
  "cursor",
  "page",
  "pageSize",
  "perPage",
  "per_page",
  "page_size",
  "order",
  "orderBy",
  "order_by",
  "sort",
  "sortBy",
  "sort_by",
  "direction",
]);

/** Partitioned contract input. */
export type ContractInputSplit = {
  readonly parameters: readonly FormField[];
  readonly fields: readonly FormField[];
};

/**
 * Path tokens plus list/query keys → parameters; everything else → fields.
 *
 * @param input - `flow.in` fields
 * @param pathParams - `:id` names from the HTTP path
 */
export function splitContractInput(
  input: readonly FormField[],
  pathParams: readonly string[] = [],
): ContractInputSplit {
  const seen = new Set<string>();
  const parameters: FormField[] = [];
  for (const name of pathParams) {
    seen.add(name);
    const fromSchema = input.find((f) => f.name === name);
    parameters.push(fromSchema ?? pathParamField(name));
  }
  const fields: FormField[] = [];
  for (const field of input) {
    if (seen.has(field.name)) continue;
    if (PARAM_NAMES.has(field.name)) parameters.push(field);
    else fields.push(field);
  }
  return { parameters, fields };
}

function pathParamField(name: string): FormField {
  return {
    path: `/path/${name}`,
    name,
    type: "string",
    required: true,
  };
}

/** Call API request sections — path vs query vs JSON body. */
export type CallApiInputSplit = {
  readonly path: readonly string[];
  readonly query: readonly FormField[];
  readonly body: readonly FormField[];
};

/**
 * Partition `flow.in` the way the typed client puts fields on the wire.
 *
 * Path tokens never appear in query or body. `GET` / `HEAD` / `DELETE`
 * leftover fields are query. Other HTTP verbs and non-HTTP triggers keep a
 * JSON body (minus path tokens).
 *
 * @param input - `flow.in` fields
 * @param options - Route tokens + HTTP method
 */
export function splitCallApiInput(
  input: readonly FormField[],
  options: {
    readonly pathParams?: readonly string[];
    readonly method?: string | null;
    readonly http?: boolean;
  } = {},
): CallApiInputSplit {
  const pathParams = options.pathParams ?? [];
  const pathSet = new Set(pathParams);
  if (options.http !== true) {
    return { path: [], query: [], body: input };
  }
  const leftover = input.filter((field) => !pathSet.has(field.name));
  if (!httpMethodHasBody(options.method)) {
    return { path: pathParams, query: leftover, body: [] };
  }
  return { path: pathParams, query: [], body: leftover };
}

/**
 * Keep schema seed keys that belong to a Call API section.
 *
 * @param seed - Full `flow.in` seed
 * @param fields - Section fields
 */
export function pickSeedFields(
  seed: Record<string, unknown>,
  fields: readonly FormField[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.hasOwn(seed, field.name)) out[field.name] = seed[field.name];
  }
  return out;
}
