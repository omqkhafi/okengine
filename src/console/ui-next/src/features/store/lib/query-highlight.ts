/**
 * Sync token colors for the Store query editors.
 *
 * SQL uses keyword / string / number / comment ink. KV uses command / key /
 * string / comment ink so `list drafts:` does not look like bash.
 */

/** Query console grammars. */
export type QueryHighlightLanguage = "sql" | "kv";

/** One colored span. */
export type QueryHighlightKind =
  | "text"
  | "comment"
  | "keyword"
  | "command"
  | "string"
  | "ident"
  | "number"
  | "punct"
  | "operator"
  | "atom";

/** Token in source order. Concatenating `text` rebuilds the buffer. */
export type QueryHighlightToken = {
  readonly kind: QueryHighlightKind;
  readonly text: string;
};

const SQL_KEYWORDS = new Set([
  "ABORT",
  "ADD",
  "ALL",
  "ALTER",
  "ANALYZE",
  "AND",
  "ANY",
  "AS",
  "ASC",
  "BETWEEN",
  "BEGIN",
  "BY",
  "CASCADE",
  "CASE",
  "CAST",
  "CHECK",
  "COALESCE",
  "COLUMN",
  "COMMIT",
  "CONFLICT",
  "CONSTRAINT",
  "CREATE",
  "CROSS",
  "CURRENT",
  "DEFAULT",
  "DELETE",
  "DESC",
  "DISTINCT",
  "DO",
  "DROP",
  "ELSE",
  "END",
  "EXCEPT",
  "EXISTS",
  "EXPLAIN",
  "FALSE",
  "FOREIGN",
  "FROM",
  "FULL",
  "GRANT",
  "GROUP",
  "HAVING",
  "IF",
  "ILIKE",
  "IN",
  "INDEX",
  "INNER",
  "INSERT",
  "INTERSECT",
  "INTO",
  "IS",
  "JOIN",
  "KEY",
  "LATERAL",
  "LEFT",
  "LIKE",
  "LIMIT",
  "MATERIALIZED",
  "NATURAL",
  "NOT",
  "NULL",
  "NULLIF",
  "OFFSET",
  "ON",
  "ONLY",
  "OR",
  "ORDER",
  "OUTER",
  "OVER",
  "PARTITION",
  "PRIMARY",
  "RECURSIVE",
  "REFERENCES",
  "RETURNING",
  "RIGHT",
  "ROLLBACK",
  "SELECT",
  "SET",
  "TABLE",
  "THEN",
  "TRUE",
  "TRUNCATE",
  "UNION",
  "UNIQUE",
  "UPDATE",
  "USING",
  "VALUES",
  "VIEW",
  "WHEN",
  "WHERE",
  "WITH",
]);

const SQL_ATOMS = new Set(["TRUE", "FALSE", "NULL"]);

const KV_COMMANDS = new Set(["list", "get", "set", "delete", "ttl"]);
const KV_ATOMS = new Set(["true", "false", "null", "value"]);

const WORD = /[A-Za-z_\u0080-\uFFFF]/;
const WORD_CONT = /[A-Za-z0-9_\u0080-\uFFFF]/;

/**
 * Tokenize a query buffer for the overlay highlighter.
 *
 * @param source - Editor contents
 * @param language - SQL or KV
 */
export function highlightQuery(
  source: string,
  language: QueryHighlightLanguage,
): readonly QueryHighlightToken[] {
  return language === "kv" ? tokenizeKv(source) : tokenizeSql(source);
}

function tokenizeSql(source: string): QueryHighlightToken[] {
  const tokens: QueryHighlightToken[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i] ?? "";
    const next = source[i + 1] ?? "";

    if (ch === "-" && next === "-") {
      i = pushLineComment(source, i, tokens);
      continue;
    }
    if (ch === "/" && next === "*") {
      i = pushBlockComment(source, i, tokens);
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      i = pushQuoted(source, i, ch, tokens, ch === "'" ? "string" : "ident");
      continue;
    }
    if (isDigit(ch) || (ch === "." && isDigit(next))) {
      i = pushNumber(source, i, tokens);
      continue;
    }
    if (WORD.test(ch)) {
      const start = i;
      i += 1;
      while (i < source.length && WORD_CONT.test(source[i] ?? "")) i += 1;
      const text = source.slice(start, i);
      const upper = text.toUpperCase();
      if (SQL_ATOMS.has(upper)) tokens.push({ kind: "atom", text });
      else if (SQL_KEYWORDS.has(upper)) tokens.push({ kind: "keyword", text });
      else tokens.push({ kind: "text", text });
      continue;
    }
    if (isOperator(ch)) {
      const start = i;
      i += 1;
      while (i < source.length && isOperator(source[i] ?? "")) i += 1;
      tokens.push({ kind: "operator", text: source.slice(start, i) });
      continue;
    }
    if (isPunct(ch)) {
      tokens.push({ kind: "punct", text: ch });
      i += 1;
      continue;
    }
    i = pushRun(source, i, tokens, (c, idx) => !isSpecialSqlStart(c, source, idx));
  }
  return mergeSameKind(tokens);
}

function tokenizeKv(source: string): QueryHighlightToken[] {
  const tokens: QueryHighlightToken[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i] ?? "";
    const next = source[i + 1] ?? "";

    if (ch === "/" && next === "/") {
      i = pushLineComment(source, i, tokens);
      continue;
    }
    if (ch === "#") {
      i = pushLineComment(source, i, tokens);
      continue;
    }
    if (ch === "-" && next === "-") {
      i = pushLineComment(source, i, tokens);
      continue;
    }
    if (ch === "'" || ch === '"') {
      i = pushQuoted(source, i, ch, tokens, "string");
      continue;
    }
    if (isDigit(ch)) {
      i = pushKvNumberOrDuration(source, i, tokens);
      continue;
    }
    if (WORD.test(ch)) {
      const start = i;
      i += 1;
      while (i < source.length && WORD_CONT.test(source[i] ?? "")) i += 1;
      const text = source.slice(start, i);
      const lower = text.toLowerCase();
      if (KV_COMMANDS.has(lower)) tokens.push({ kind: "command", text });
      else if (KV_ATOMS.has(lower)) tokens.push({ kind: "atom", text });
      else tokens.push({ kind: "ident", text });
      continue;
    }
    if (ch === ":") {
      tokens.push({ kind: "punct", text: ch });
      i += 1;
      continue;
    }
    if (isPunct(ch) || ch === "{" || ch === "}" || ch === "[" || ch === "]") {
      tokens.push({ kind: "punct", text: ch });
      i += 1;
      continue;
    }
    i = pushRun(source, i, tokens, (c, idx) => {
      if (c === "/" || c === "#" || c === "'" || c === '"') return false;
      if (c === "-" && source[idx + 1] === "-") return false;
      if (isDigit(c) || WORD.test(c) || isPunct(c)) return false;
      if (c === "{" || c === "}" || c === "[" || c === "]" || c === ":") return false;
      return true;
    });
  }
  return mergeSameKind(tokens);
}

function pushLineComment(source: string, start: number, tokens: QueryHighlightToken[]): number {
  let i = start;
  while (i < source.length && source[i] !== "\n") i += 1;
  tokens.push({ kind: "comment", text: source.slice(start, i) });
  return i;
}

function pushBlockComment(source: string, start: number, tokens: QueryHighlightToken[]): number {
  let i = start + 2;
  while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
  if (i < source.length) i += 2;
  tokens.push({ kind: "comment", text: source.slice(start, i) });
  return i;
}

function pushQuoted(
  source: string,
  start: number,
  quote: string,
  tokens: QueryHighlightToken[],
  kind: QueryHighlightKind,
): number {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === quote) {
      if (source[i + 1] === quote) {
        i += 2;
        continue;
      }
      i += 1;
      break;
    }
    if (source[i] === "\\" && quote === "'") {
      i += 2;
      continue;
    }
    i += 1;
  }
  tokens.push({ kind, text: source.slice(start, i) });
  return i;
}

function pushNumber(source: string, start: number, tokens: QueryHighlightToken[]): number {
  let i = start;
  if (source[i] === ".") i += 1;
  while (i < source.length && isDigit(source[i] ?? "")) i += 1;
  if (source[i] === "." && isDigit(source[i + 1] ?? "")) {
    i += 1;
    while (i < source.length && isDigit(source[i] ?? "")) i += 1;
  }
  const exp = source[i];
  if (exp === "e" || exp === "E") {
    let j = i + 1;
    if (source[j] === "+" || source[j] === "-") j += 1;
    if (isDigit(source[j] ?? "")) {
      i = j + 1;
      while (i < source.length && isDigit(source[i] ?? "")) i += 1;
    }
  }
  tokens.push({ kind: "number", text: source.slice(start, i) });
  return i;
}

function pushKvNumberOrDuration(
  source: string,
  start: number,
  tokens: QueryHighlightToken[],
): number {
  const after = pushNumber(source, start, tokens);
  const last = tokens[tokens.length - 1];
  if (!last) return after;
  const unit = source[after];
  if (unit && /[smhd]/i.test(unit) && !WORD_CONT.test(source[after + 1] ?? "")) {
    tokens[tokens.length - 1] = { kind: "number", text: `${last.text}${unit}` };
    return after + 1;
  }
  return after;
}

function pushRun(
  source: string,
  start: number,
  tokens: QueryHighlightToken[],
  take: (ch: string, index: number) => boolean,
): number {
  let i = start;
  while (i < source.length && take(source[i] ?? "", i)) i += 1;
  if (i === start) {
    tokens.push({ kind: "text", text: source[start] ?? "" });
    return start + 1;
  }
  tokens.push({ kind: "text", text: source.slice(start, i) });
  return i;
}

function mergeSameKind(tokens: readonly QueryHighlightToken[]): QueryHighlightToken[] {
  const out: QueryHighlightToken[] = [];
  for (const token of tokens) {
    const prev = out[out.length - 1];
    if (prev && prev.kind === token.kind) {
      out[out.length - 1] = { kind: prev.kind, text: `${prev.text}${token.text}` };
    } else {
      out.push(token);
    }
  }
  return out;
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isOperator(ch: string): boolean {
  return "+-*/%=<>!&|^~".includes(ch);
}

function isPunct(ch: string): boolean {
  return "(),;.".includes(ch);
}

function isSpecialSqlStart(ch: string, source: string, i: number): boolean {
  if (ch === "'" || ch === '"' || ch === "`") return true;
  if (ch === "-" && source[i + 1] === "-") return true;
  if (ch === "/" && source[i + 1] === "*") return true;
  if (isDigit(ch) || (ch === "." && isDigit(source[i + 1] ?? ""))) return true;
  if (WORD.test(ch) || isOperator(ch) || isPunct(ch)) return true;
  return false;
}
