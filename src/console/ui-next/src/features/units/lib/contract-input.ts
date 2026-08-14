/**
 * Split flow input into query/path parameters vs body / filter fields.
 */

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
