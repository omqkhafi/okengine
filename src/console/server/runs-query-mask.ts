/**
 * Conservative PII mask for free-form runs SQL rows.
 *
 * Matches result column names (and `dim_<name>` promotions) plus known JSON
 * blobs. Aliases and expressions are the named {@link RUNS_QUERY_PII_GAP}.
 */

import { addPiiFieldName, PII_MASK } from "../../elements/store/classify.ts";
import type { RunsRow } from "../../runs/types.ts";
import { maskPiiValue } from "./runs-pii.ts";
import { RUNS_QUERY_PII_GAP } from "./runs-query-guard.ts";

/** JSON columns written by `wideEventToRow`. */
const JSON_COLUMNS = new Set(["input", "output", "logs", "dimensions"]);

/**
 * Mask a SQL result set using Manifest PII field names.
 *
 * @param rows - DuckDB rows
 * @param piiFields - Classified names (plus aliases)
 * @param revealPii - When true, return a shallow copy unmasked
 */
export function maskRunsQueryRows(
  rows: readonly RunsRow[],
  piiFields: ReadonlySet<string>,
  revealPii = false,
): RunsRow[] {
  if (revealPii || piiFields.size === 0) {
    return rows.map((row) => ({ ...row }));
  }
  const names = expandDimAliases(piiFields);
  return rows.map((row) => maskOneRow(row, names));
}

/**
 * Expand classified names with `dim_` promotions used on the Parquet row.
 *
 * @param piiFields - Manifest field names
 */
export function expandDimAliases(piiFields: ReadonlySet<string>): ReadonlySet<string> {
  const names = new Set<string>();
  for (const field of piiFields) {
    addPiiFieldName(names, field);
    names.add(`dim_${field}`);
    const snake = field
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
      .toLowerCase();
    names.add(`dim_${snake}`);
  }
  return names;
}

function maskOneRow(row: RunsRow, piiFields: ReadonlySet<string>): RunsRow {
  const out: RunsRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (piiFields.has(key)) {
      out[key] = PII_MASK;
      continue;
    }
    if (JSON_COLUMNS.has(key)) {
      out[key] = maskJsonColumn(value, piiFields);
      continue;
    }
    out[key] = value;
  }
  return out;
}

function maskJsonColumn(value: unknown, piiFields: ReadonlySet<string>): unknown {
  if (typeof value !== "string") {
    return maskPiiValue(value, piiFields);
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return JSON.stringify(maskPiiValue(parsed, piiFields));
  } catch {
    return value;
  }
}

export { RUNS_QUERY_PII_GAP };
