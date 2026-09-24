/**
 * Export reviewed labels as certify seed JSONL.
 * Only the decision's declared `in` fields are written.
 */

import { maskRedactedDeep, REDACTED_PLACEHOLDER } from "../../../kernel/redacted.ts";
import type { DecisionLabel } from "./certificate.ts";

/** Fields the export may copy out of a stored input. */
export interface DecisionExportFields {
  readonly fields: readonly string[];
  readonly secretFields: readonly string[];
}

/** One exported seed line. */
export interface DecisionExportLine {
  readonly input: Readonly<Record<string, unknown>>;
  readonly expect: Readonly<Record<string, unknown>>;
  readonly locale?: string;
}

/**
 * Read declared `in` keys. A field marked secret or redacted is masked.
 *
 * @param schema - Zod object from `ai.decision({ in })`, when one was declared
 */
export function decisionExportFields(schema: unknown): DecisionExportFields {
  const shape = zodShape(schema);
  const fields = Object.keys(shape);
  const secretFields = fields.filter((name) => secretMarked(shape[name]));
  return { fields, secretFields };
}

/**
 * Group labels that share a write time into seed rows.
 * A requested tenant that is not the caller's is rejected.
 *
 * @param options - Labels, the caller's tenant, and the declared fields
 */
export function exportDecisionLabels(options: {
  readonly labels: readonly DecisionLabel[];
  readonly callerTenant: string | null;
  readonly requestedTenant?: string | null;
  readonly fields: DecisionExportFields;
}): { ok: true; lines: string } | { ok: false; status: 404 } {
  if (
    options.requestedTenant != null &&
    options.requestedTenant !== (options.callerTenant ?? null)
  ) {
    return { ok: false, status: 404 };
  }
  const tenant = options.callerTenant;
  const kept = options.labels.filter((label) => (label.tenant ?? null) === tenant);
  const groups = new Map<string, DecisionLabel[]>();
  for (const label of kept) {
    const key = label.reviewId ?? looseGroupKey(label, options.fields);
    const group = groups.get(key);
    if (group) group.push(label);
    else groups.set(key, [label]);
  }
  const lines: string[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    const row: DecisionExportLine = {
      input: maskDecisionInput(first.input, options.fields),
      expect: Object.fromEntries(group.map((label) => [label.question, label.value])),
      ...(first.locale !== undefined ? { locale: first.locale } : {}),
    };
    lines.push(JSON.stringify(row));
  }
  return { ok: true, lines: lines.length > 0 ? `${lines.join("\n")}\n` : "" };
}

/**
 * Labels with no review id group by decision, the non-secret input, reviewer, and time.
 *
 * @param label - Stored label
 * @param fields - Declared `in` fields
 */
function looseGroupKey(label: DecisionLabel, fields: DecisionExportFields): string {
  const source =
    label.input && typeof label.input === "object" && !Array.isArray(label.input)
      ? (label.input as Record<string, unknown>)
      : {};
  const secret = new Set(fields.secretFields);
  const picked: Record<string, unknown> = {};
  for (const name of fields.fields) {
    if (secret.has(name)) continue;
    if (Object.prototype.hasOwnProperty.call(source, name)) picked[name] = source[name];
  }
  return `${label.decision}:${JSON.stringify(picked)}:${label.reviewer}:${label.at ?? 0}`;
}

/** Printed by `oke decide labels --export`. The file itself is only JSONL. */
export const DECISION_EXPORT_WARNING = "This file contains production data.";

/** Keep declared fields and replace secret or redacted values. */
export function maskDecisionInput(
  input: unknown,
  fields: DecisionExportFields,
): Record<string, unknown> {
  const source =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const secret = new Set(fields.secretFields);
  const picked: Record<string, unknown> = {};
  for (const name of fields.fields) {
    if (!Object.prototype.hasOwnProperty.call(source, name)) continue;
    picked[name] = secret.has(name) ? REDACTED_PLACEHOLDER : source[name];
  }
  return maskRedactedDeep(picked);
}

function zodShape(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return {};
  const shape = (schema as { shape?: unknown }).shape;
  if (shape && typeof shape === "object" && !Array.isArray(shape)) {
    return shape as Record<string, unknown>;
  }
  return {};
}

function secretMarked(field: unknown): boolean {
  let current = field;
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth++) {
    if (marker(current)) return true;
    const unwrap = (current as { unwrap?: () => unknown }).unwrap;
    if (typeof unwrap !== "function") return false;
    const next = unwrap.call(current);
    if (next === current) return false;
    current = next;
  }
  return false;
}

function marker(field: object): boolean {
  const record = field as { description?: string; meta?: () => unknown };
  if (record.description === "secret" || record.description === "redacted") return true;
  if (typeof record.meta !== "function") return false;
  const meta = record.meta();
  if (!meta || typeof meta !== "object") return false;
  const flags = meta as Record<string, unknown>;
  return flags.secret === true || flags.redacted === true;
}
