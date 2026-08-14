/**
 * KV console command language — the `fx.store` handle:
 * `list`, `get`, `set`, `delete`, and `ttl` (`ttlMs`).
 */

import { parseKvTtlDraft } from "./kv-meta.ts";

/** Parsed KV console command. */
export type KvQueryCommand =
  | { readonly kind: "list"; readonly prefix: string }
  | { readonly kind: "get"; readonly key: string }
  | { readonly kind: "delete"; readonly key: string }
  | { readonly kind: "ttl"; readonly key: string }
  | {
      readonly kind: "set";
      readonly key: string;
      readonly keepValue: boolean;
      readonly value?: unknown;
      readonly ttl?: string | null;
    };

/** Failed parse. */
export type KvQueryError = { readonly kind: "error"; readonly message: string };

/** Parse result. */
export type KvQueryParse = KvQueryCommand | KvQueryError;

const COMMENT = /^\s*(\/\/|#|--)/;
const COMMAND = /^(list|get|set|delete|ttl)\b/i;

/**
 * Parse the last KV command in a console buffer.
 *
 * Word form (`get key`) and call form (`get("key")`) are both accepted.
 * `set(...)` may span lines (Pending Changes emits pretty-printed JSON).
 * Bare tokens (no spaces) are a list prefix. Empty input lists the whole store.
 *
 * @param text - Editor contents
 */
export function parseKvQuery(text: string): KvQueryParse {
  const statement = lastKvStatement(text);
  if (statement.length === 0) return { kind: "list", prefix: "" };

  const name = COMMAND.exec(statement)?.[1]?.toLowerCase();
  if (name === "set") return parseSetCommand(statement);
  if (name === "list") return parseListCommand(statement);
  if (name === "get" || name === "delete" || name === "ttl") {
    return parseKeyedCommand(name, statement);
  }

  const line = lastCommandLine(statement) ?? statement;
  if (!/\s/.test(line)) return { kind: "list", prefix: line };

  return {
    kind: "error",
    message: "Use `list`, `get`, `set`, `delete`, or `ttl`.",
  };
}

/**
 * `POST /console/store/edit` patch for a parsed `set`.
 *
 * Identifier `value` keeps the current payload. A missing TTL preserves
 * remaining expiry; `ttl: null` clears it.
 *
 * @param command - Parsed set
 */
export function kvSetPatch(
  command: Extract<KvQueryCommand, { kind: "set" }>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (!command.keepValue) patch.value = command.value;
  if (command.ttl !== undefined) patch.ttl = command.ttl;
  return patch;
}

/**
 * Last executable line (skips blanks and `//` / `#` / `--` comments).
 *
 * @param text - Buffer
 */
export function lastCommandLine(text: string): string | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim() ?? "";
    if (line.length === 0 || COMMENT.test(line)) continue;
    return line;
  }
  return null;
}

/**
 * Last handle command, including a multiline `set(...)`.
 *
 * @param text - Buffer
 */
export function lastKvStatement(text: string): string {
  const lines = text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? "";
    if (line.length === 0 || COMMENT.test(line)) continue;
    if (COMMAND.test(line)) start = i;
  }
  if (start >= 0) return lines.slice(start).join("\n").trim();
  return lastCommandLine(text) ?? "";
}

function parseListCommand(statement: string): KvQueryParse {
  if (statement.includes("(")) {
    const parsed = parseParenArgs(statement, "list");
    if (parsed.kind === "error") return parsed;
    if (parsed.args.length === 0) return { kind: "list", prefix: "" };
    if (parsed.args.length > 1) {
      return { kind: "error", message: "list takes an optional prefix." };
    }
    const prefix = parseStringArg(parsed.args[0] ?? "", "list prefix");
    if (prefix.kind === "error") return prefix;
    return { kind: "list", prefix: prefix.value };
  }
  const list = /^list(?:\s+(\S.*))?$/i.exec(lastCommandLine(statement) ?? statement);
  if (!list) return { kind: "error", message: "Use `list [prefix]` or `list(\"prefix\")`." };
  return { kind: "list", prefix: list[1]?.trim() ?? "" };
}

function parseKeyedCommand(
  kind: "get" | "delete" | "ttl",
  statement: string,
): KvQueryParse {
  if (statement.includes("(")) {
    const parsed = parseParenArgs(statement, kind);
    if (parsed.kind === "error") return parsed;
    if (parsed.args.length !== 1) {
      return { kind: "error", message: `${kind} requires a key.` };
    }
    const key = parseStringArg(parsed.args[0] ?? "", `${kind} key`);
    if (key.kind === "error") return key;
    if (key.value.length === 0) return { kind: "error", message: `${kind} requires a key.` };
    return { kind, key: key.value };
  }
  const match = new RegExp(`^${kind}(?:\\s+(\\S.*))?$`, "i").exec(
    lastCommandLine(statement) ?? statement,
  );
  const key = match?.[1]?.trim() ?? "";
  if (key.length === 0) return { kind: "error", message: `${kind} requires a key.` };
  return { kind, key };
}

function parseSetCommand(statement: string): KvQueryParse {
  const open = statement.indexOf("(");
  if (open < 0 || !/^set\s*\(/i.test(statement.slice(0, open + 1))) {
    return { kind: "error", message: "set requires `set(key, value, ttl?)`." };
  }
  const parsed = parseParenArgs(statement, "set");
  if (parsed.kind === "error") return parsed;
  const args = parsed.args;
  if (args.length < 2) {
    return { kind: "error", message: "set requires a key and a value." };
  }
  if (args.length > 3) {
    return { kind: "error", message: "set takes key, value, and optional TTL." };
  }

  const keyParsed = parseJsonArg(args[0] ?? "");
  if (!keyParsed.ok || typeof keyParsed.value !== "string" || keyParsed.value.length === 0) {
    return { kind: "error", message: "set key must be a string." };
  }

  const valueRaw = args[1] ?? "";
  const keepValue = valueRaw === "value";
  let value: unknown;
  if (!keepValue) {
    const valueParsed = parseJsonArg(valueRaw);
    if (!valueParsed.ok) {
      return { kind: "error", message: `set value: ${valueParsed.error}` };
    }
    value = valueParsed.value;
  }

  let ttl: string | null | undefined;
  if (args[2] !== undefined) {
    const ttlParsed = parseJsonArg(args[2]);
    if (!ttlParsed.ok || typeof ttlParsed.value !== "string") {
      return { kind: "error", message: 'TTL must be a duration string like "30m".' };
    }
    const draft = parseKvTtlDraft(ttlParsed.value);
    if (draft === undefined) {
      return { kind: "error", message: "TTL must be a duration like 30m, 1h, or empty." };
    }
    ttl = draft;
  } else if (keepValue) {
    ttl = null;
  }

  return keepValue
    ? { kind: "set", key: keyParsed.value, keepValue: true, ttl }
    : { kind: "set", key: keyParsed.value, keepValue: false, value, ttl };
}

function parseParenArgs(
  statement: string,
  name: string,
): { readonly kind: "ok"; readonly args: readonly string[] } | KvQueryError {
  const open = statement.indexOf("(");
  if (open < 0) return { kind: "error", message: `${name} requires parentheses.` };
  const close = matchingClose(statement, open);
  if (close < 0) return { kind: "error", message: `Unclosed ${name}(…).` };
  const trailing = statement.slice(close + 1).trim();
  if (trailing.length > 0 && !COMMENT.test(trailing)) {
    return { kind: "error", message: `Unexpected input after ${name}(…).` };
  }
  return { kind: "ok", args: splitArgs(statement.slice(open + 1, close)) };
}

function parseStringArg(
  raw: string,
  label: string,
): { readonly kind: "ok"; readonly value: string } | KvQueryError {
  const parsed = parseJsonArg(raw);
  if (!parsed.ok || typeof parsed.value !== "string") {
    return { kind: "error", message: `${label} must be a string.` };
  }
  return { kind: "ok", value: parsed.value };
}

function parseJsonArg(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "invalid JSON" };
  }
}

function splitArgs(inner: string): string[] {
  const args: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  let escape = false;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i] ?? "";
    if (quote) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") {
      depth += 1;
      continue;
    }
    if (ch === "}" || ch === "]" || ch === ")") {
      depth -= 1;
      continue;
    }
    if (ch === "," && depth === 0) {
      const part = inner.slice(start, i).trim();
      if (part.length > 0) args.push(part);
      start = i + 1;
    }
  }
  const last = inner.slice(start).trim();
  if (last.length > 0) args.push(last);
  return args;
}

function matchingClose(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  let escape = false;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (quote) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0 && ch === ")") return i;
    }
  }
  return -1;
}
