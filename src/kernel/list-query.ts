/**
 * PostgREST v16 read grammar — in-memory.
 *
 * https://docs.postgrest.org/en/v16/references/api/tables_views.html
 *
 * Shipped: horizontal filters (eq/neq/gt/gte/lt/lte/like/ilike/in/is/match/imatch
 * + `not.` + `any`/`all`), `or=` / `and=` (nested), `order=` (nullsfirst/last),
 * `select=` (aliases). OKE extras: `q`/`search`, `cursor`.
 *
 * Not shipped (SQL/Postgres-only or out of scope): FTS, range/array ops,
 * resource embedding, JSON arrows, Prefer/Range headers.
 */

/** Column whitelist for filter / order / select. */
export type ColumnScope<T> = "all" | "none" | readonly (keyof T & string)[];

/** Comparison operators we evaluate in memory. */
export type FilterOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike"
  | "match"
  | "imatch"
  | "in"
  | "is";

const FILTER_OPS = new Set<string>([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "match",
  "imatch",
  "in",
  "is",
]);

/** Reserved list keys — not column filters. */
export const LIST_RESERVED = new Set([
  "cursor",
  "limit",
  "offset",
  "search",
  "q",
  "order",
  "orderBy",
  "select",
  "or",
  "and",
  "headers",
  "cookie",
]);

/** One `order=` term. */
export type OrderTerm = {
  readonly key: string;
  readonly dir: "asc" | "desc";
  readonly nulls?: "first" | "last";
};

/** `select=` term (`alias:col` or `col`). */
export type SelectTerm = {
  readonly key: string;
  readonly alias: string;
};

type CmpNode = {
  readonly kind: "cmp";
  readonly col: string;
  readonly op: FilterOp;
  readonly value: unknown;
  readonly not: boolean;
  readonly modifier?: "any" | "all";
};

type GroupNode = {
  readonly kind: "group";
  readonly joiner: "and" | "or";
  readonly not: boolean;
  readonly parts: readonly FilterNode[];
};

/** Parsed filter tree. */
export type FilterNode = CmpNode | GroupNode;

/**
 * Split on commas that are not inside quotes or parentheses.
 *
 * @param inner - Group body without the wrapping `()`
 */
export function splitTopLevel(inner: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let depth = 0;
  let quote = false;
  for (const ch of inner) {
    if (quote) {
      if (ch === '"') quote = false;
      buf += ch;
      continue;
    }
    if (ch === '"') {
      quote = true;
      buf += ch;
      continue;
    }
    if (ch === "(" || ch === "{") {
      depth += 1;
      buf += ch;
      continue;
    }
    if (ch === ")" || ch === "}") {
      depth -= 1;
      buf += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      parts.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim().length > 0) parts.push(buf.trim());
  return parts;
}

function unquote(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  return t;
}

function parseInList(raw: string): string[] | null {
  const match = /^\((.*)\)$/.exec(raw.trim());
  if (!match) return null;
  const inner = match[1]!.trim();
  if (inner.length === 0) return [];
  return splitTopLevel(inner).map(unquote);
}

function parseAnyAllList(raw: string): string[] | null {
  const match = /^\{(.*)\}$/.exec(raw.trim());
  if (!match) return null;
  const inner = match[1]!.trim();
  if (inner.length === 0) return [];
  return splitTopLevel(inner).map(unquote);
}

/**
 * Parse `eq.x` / `not.like.*p*` / `like(any).{O*,P*}` / `is.null`.
 *
 * @param raw - Operator + value
 */
export function parseOpValue(raw: string): Omit<CmpNode, "kind" | "col"> | { error: string } {
  let rest = raw.trim();
  let not = false;
  if (rest.startsWith("not.")) {
    not = true;
    rest = rest.slice(4);
  }
  const paren = /^([a-z]+)\((any|all)\)\.(.*)$/.exec(rest);
  if (paren) {
    const op = paren[1]!;
    const modifier = paren[2] as "any" | "all";
    const values = parseAnyAllList(paren[3]!);
    if (!FILTER_OPS.has(op) || values === null || values.length === 0) {
      return { error: `expected "${op}(${modifier}).{a,b}"` };
    }
    return { op: op as FilterOp, value: values, not, modifier };
  }
  const dot = rest.indexOf(".");
  if (dot <= 0) return { error: 'expected "op.value" (e.g. eq.x)' };
  const op = rest.slice(0, dot);
  const value = rest.slice(dot + 1);
  if (!FILTER_OPS.has(op)) return { error: `unsupported filter op "${op}"` };
  if (op === "in") {
    const values = parseInList(value);
    if (values === null || values.length === 0) return { error: "in expects (a,b,c)" };
    return { op: "in", value: values, not };
  }
  if (op === "is") {
    if (!["null", "not_null", "true", "false", "unknown"].includes(value)) {
      return { error: "is expects null|not_null|true|false|unknown" };
    }
    return { op: "is", value, not };
  }
  return { op: op as FilterOp, value: unquote(value), not };
}

function parseGroupBody(
  raw: string,
  joiner: "and" | "or",
  not: boolean,
): FilterNode | { error: string } {
  const match = /^\((.*)\)$/.exec(raw.trim());
  if (!match) return { error: `${joiner} expects (col.op.value,…)` };
  const parts = splitTopLevel(match[1]!);
  if (parts.length === 0) return { error: `${joiner} expects (col.op.value,…)` };
  const nodes: FilterNode[] = [];
  for (const part of parts) {
    const node = parseTerm(part);
    if ("error" in node) return node;
    nodes.push(node);
  }
  return { kind: "group", joiner, not, parts: nodes };
}

/**
 * Parse one `or=` / `and=` term or `col.op.value`.
 *
 * @param term - One comma-separated piece
 */
export function parseTerm(term: string): FilterNode | { error: string } {
  const t = term.trim();
  if (t.startsWith("not.and")) return parseGroupBody(t.slice(7), "and", true);
  if (t.startsWith("not.or")) return parseGroupBody(t.slice(6), "or", true);
  if (t.startsWith("and")) return parseGroupBody(t.slice(3), "and", false);
  if (t.startsWith("or")) return parseGroupBody(t.slice(2), "or", false);
  const dot = t.indexOf(".");
  if (dot <= 0) return { error: 'expected "col.op.value"' };
  const col = t.slice(0, dot);
  const parsed = parseOpValue(t.slice(dot + 1));
  if ("error" in parsed) return parsed;
  return { kind: "cmp", col, ...parsed };
}

/**
 * Parse `order=age.desc,height.asc.nullslast`.
 *
 * @param raw - Order query value
 */
export function parseOrder(raw: string): OrderTerm[] | { error: string } {
  const terms: OrderTerm[] = [];
  for (const piece of raw.split(",")) {
    const parts = piece.trim().split(".");
    const key = parts[0];
    if (!key) return { error: `bad order term "${piece}"` };
    let dir: "asc" | "desc" = "asc";
    let nulls: "first" | "last" | undefined;
    for (const flag of parts.slice(1)) {
      if (flag === "asc" || flag === "desc") dir = flag;
      else if (flag === "nullsfirst") nulls = "first";
      else if (flag === "nullslast") nulls = "last";
      else return { error: `bad order term "${piece}"` };
    }
    terms.push({ key, dir, ...(nulls !== undefined ? { nulls } : {}) });
  }
  return terms;
}

/**
 * Parse `select=id,fullName:title`.
 *
 * @param raw - Select query value
 */
export function parseSelect(raw: string): SelectTerm[] | { error: string } {
  const terms: SelectTerm[] = [];
  for (const piece of raw.split(",")) {
    const t = piece.trim();
    if (t.length === 0) return { error: "empty select term" };
    const colon = t.indexOf(":");
    if (colon > 0) {
      terms.push({ alias: t.slice(0, colon), key: t.slice(colon + 1) });
    } else {
      terms.push({ alias: t, key: t });
    }
  }
  return terms;
}

function likePattern(pattern: string, value: string, insensitive: boolean): boolean {
  const src = pattern.replaceAll("*", "%");
  const escaped = src
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("%", ".*")
    .replaceAll("_", ".");
  return new RegExp(`^${escaped}$`, insensitive ? "i" : "").test(value);
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function coerce(actual: unknown, expected: string): unknown {
  if (typeof actual === "number" && expected.trim() !== "" && Number.isFinite(Number(expected))) {
    return Number(expected);
  }
  if (typeof actual === "boolean") {
    if (expected === "true") return true;
    if (expected === "false") return false;
  }
  return expected;
}

function matchOne(actual: unknown, op: FilterOp, expected: unknown): boolean {
  switch (op) {
    case "eq":
      return compareValues(actual, coerce(actual, String(expected))) === 0;
    case "neq":
      return compareValues(actual, coerce(actual, String(expected))) !== 0;
    case "gt":
      return compareValues(actual, coerce(actual, String(expected))) > 0;
    case "gte":
      return compareValues(actual, coerce(actual, String(expected))) >= 0;
    case "lt":
      return compareValues(actual, coerce(actual, String(expected))) < 0;
    case "lte":
      return compareValues(actual, coerce(actual, String(expected))) <= 0;
    case "like":
      return likePattern(String(expected), String(actual ?? ""), false);
    case "ilike":
      return likePattern(String(expected), String(actual ?? ""), true);
    case "match":
      return new RegExp(String(expected)).test(String(actual ?? ""));
    case "imatch":
      return new RegExp(String(expected), "i").test(String(actual ?? ""));
    case "in":
      return (expected as readonly string[]).some(
        (v) => compareValues(actual, coerce(actual, v)) === 0,
      );
    case "is": {
      if (expected === "null" || expected === "unknown") return actual == null;
      if (expected === "not_null") return actual != null;
      if (expected === "true") return actual === true || actual === "true";
      if (expected === "false") return actual === false || actual === "false";
      return false;
    }
  }
}

function matchCmp(item: Record<string, unknown>, node: CmpNode): boolean {
  const actual = item[node.col];
  let hit: boolean;
  if (node.modifier !== undefined && Array.isArray(node.value)) {
    const results = node.value.map((v) => matchOne(actual, node.op, v));
    hit = node.modifier === "any" ? results.some(Boolean) : results.every(Boolean);
  } else {
    hit = matchOne(actual, node.op, node.value);
  }
  return node.not ? !hit : hit;
}

/**
 * Evaluate a filter tree against one row.
 *
 * @param item - Row
 * @param node - Parsed filter
 */
export function matchNode(item: Record<string, unknown>, node: FilterNode): boolean {
  if (node.kind === "cmp") return matchCmp(item, node);
  const hit =
    node.joiner === "and"
      ? node.parts.every((p) => matchNode(item, p))
      : node.parts.some((p) => matchNode(item, p));
  return node.not ? !hit : hit;
}

function allowed<T>(scope: ColumnScope<T> | undefined, key: string): boolean {
  if (scope === undefined || scope === "all") return true;
  if (scope === "none") return false;
  return scope.includes(key as keyof T & string);
}

/**
 * Collect PostgREST filter nodes from a loose query bag.
 *
 * @param query - HTTP query
 * @param filter - Column whitelist
 */
export function collectFilters<T>(
  query: Record<string, unknown>,
  filter: ColumnScope<T> | undefined,
): FilterNode[] | { error: string; path: string } {
  if (filter === "none") {
    for (const key of Object.keys(query)) {
      if (!LIST_RESERVED.has(key)) return { error: `unknown list param "${key}"`, path: key };
    }
    return [];
  }
  const nodes: FilterNode[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (LIST_RESERVED.has(key) || typeof value !== "string" || value.length === 0) continue;
    if (!value.includes(".")) continue;
    if (!allowed(filter, key))
      return { error: `unknown or unfilterable column "${key}"`, path: key };
    const parsed = parseOpValue(value);
    if ("error" in parsed) return { error: parsed.error, path: key };
    nodes.push({ kind: "cmp", col: key, ...parsed });
  }
  for (const joiner of ["or", "and"] as const) {
    const raw = query[joiner];
    if (typeof raw !== "string" || raw.length === 0) continue;
    const group = parseGroupBody(raw.startsWith("(") ? raw : `(${raw})`, joiner, false);
    if ("error" in group) return { error: group.error, path: joiner };
    const unknown = firstUnknownCol(group, filter);
    if (unknown) return { error: `unknown or unfilterable column "${unknown}"`, path: joiner };
    nodes.push(group);
  }
  return nodes;
}

function firstUnknownCol<T>(
  node: FilterNode,
  filter: ColumnScope<T> | undefined,
): string | undefined {
  if (node.kind === "cmp") return allowed(filter, node.col) ? undefined : node.col;
  for (const part of node.parts) {
    const hit = firstUnknownCol(part, filter);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Sort rows by PostgREST `order=` terms.
 *
 * @param items - Rows
 * @param terms - Parsed order
 */
export function sortByOrder<T>(items: T[], terms: readonly OrderTerm[]): T[] {
  if (terms.length === 0) return items;
  return items.sort((a, b) => {
    for (const term of terms) {
      const av = (a as Record<string, unknown>)[term.key];
      const bv = (b as Record<string, unknown>)[term.key];
      if (av == null || bv == null) {
        if (av == null && bv == null) continue;
        const nulls = term.nulls ?? (term.dir === "asc" ? "last" : "first");
        if (av == null) return nulls === "first" ? -1 : 1;
        return nulls === "first" ? 1 : -1;
      }
      const cmp = compareValues(av, bv);
      if (cmp !== 0) return term.dir === "desc" ? -cmp : cmp;
    }
    return 0;
  });
}

/**
 * Project `select=` onto each row.
 *
 * @param items - Rows
 * @param terms - Parsed select
 */
export function projectSelect<T>(items: readonly T[], terms: readonly SelectTerm[]): T[] {
  return items.map((item) => {
    const out: Record<string, unknown> = {};
    const rec = item as Record<string, unknown>;
    for (const term of terms) out[term.alias] = rec[term.key];
    return out as T;
  });
}

export { compareValues };
