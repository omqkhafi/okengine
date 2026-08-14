/**
 * Lightweight SQL pretty-print for the Store query console.
 * Keyword breaks only — not a parser.
 */

const CLAUSE =
  /\b(?:SELECT|FROM|WHERE|LEFT\s+JOIN|RIGHT\s+JOIN|INNER\s+JOIN|FULL\s+JOIN|CROSS\s+JOIN|JOIN|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|UNION(?:\s+ALL)?|EXCEPT|INTERSECT|RETURNING)\b/gi;

const INDENT = /\b(?:AND|OR|ON)\b/gi;

/**
 * Insert line breaks before major SQL clauses. Leaves quoted strings alone.
 *
 * @param sql - Raw SQL
 */
export function prettifySql(sql: string): string {
  const trimmed = sql.trim();
  if (trimmed.length === 0) return "";

  const parts = splitSqlPreservingStrings(trimmed);
  const out: string[] = [];
  for (const part of parts) {
    if (part.quoted) {
      out.push(part.text);
      continue;
    }
    const collapsed = part.text.replace(/\s+/g, " ");
    if (collapsed.length === 0) continue;
    out.push(
      collapsed
        .replace(CLAUSE, (match, offset: number, source: string) =>
          offset === 0 || source[offset - 1] === "\n"
            ? match.toUpperCase()
            : `\n${match.toUpperCase()}`,
        )
        .replace(INDENT, (match, offset: number, source: string) =>
          offset === 0 || source[offset - 1] === "\n"
            ? match.toUpperCase()
            : `\n  ${match.toUpperCase()}`,
        ),
    );
  }
  return out
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

type SqlPart = { readonly quoted: boolean; readonly text: string };

/**
 * Split SQL into quoted / unquoted spans (`'` / `"` / `` ` ``).
 *
 * @param sql - Source
 */
export function splitSqlPreservingStrings(sql: string): readonly SqlPart[] {
  const parts: SqlPart[] = [];
  let cursor = 0;
  let quote: "'" | '"' | "`" | null = null;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (quote) {
      if (ch === quote) {
        if (sql[i + 1] === quote) {
          i += 1;
          continue;
        }
        parts.push({ quoted: true, text: sql.slice(cursor, i + 1) });
        cursor = i + 1;
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      if (i > cursor) parts.push({ quoted: false, text: sql.slice(cursor, i) });
      quote = ch;
      cursor = i;
    }
  }
  if (cursor < sql.length) {
    parts.push({ quoted: quote !== null, text: sql.slice(cursor) });
  }
  return parts;
}
