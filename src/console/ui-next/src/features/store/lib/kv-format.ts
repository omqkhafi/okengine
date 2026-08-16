/**
 * Pretty-print KV console commands — call form + indented `set` JSON.
 */

import { parseKvQuery, type KvQueryCommand } from "./kv-query.ts";

const COMMENT = /^\s*(\/\/|#|--)/;
const COMMAND = /^(list|get|set|delete|ttl)\b/i;

/**
 * Format a KV console buffer: call-form commands, pretty `set` values.
 * Unparseable statements are left as written.
 *
 * @param text - Editor contents
 */
export function prettifyKv(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "";

  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]?.trim() ?? "";
    if (line.length === 0 || COMMENT.test(line)) {
      out.push(line);
      i += 1;
      continue;
    }
    let end = i + 1;
    if (COMMAND.test(line)) {
      while (end < lines.length) {
        const next = lines[end]?.trim() ?? "";
        if (COMMAND.test(next)) break;
        end += 1;
      }
    }
    const block = lines.slice(i, end);
    const trailing: string[] = [];
    while (block.length > 1) {
      const last = block[block.length - 1]?.trim() ?? "";
      if (last.length === 0 || COMMENT.test(last)) {
        trailing.unshift(block.pop()?.trim() ?? "");
        continue;
      }
      break;
    }
    out.push(formatKvStatement(block.join("\n")));
    out.push(...trailing);
    i = end;
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatKvStatement(statement: string): string {
  const parsed = parseKvQuery(statement);
  if (parsed.kind === "error") return statement.trim();
  return formatKvCommand(parsed);
}

/**
 * Render one parsed KV command in call form.
 *
 * @param command - Parsed command
 */
export function formatKvCommand(command: KvQueryCommand): string {
  switch (command.kind) {
    case "list":
      return command.prefix.length === 0 ? "list()" : `list(${JSON.stringify(command.prefix)})`;
    case "get":
    case "delete":
    case "ttl":
      return `${command.kind}(${JSON.stringify(command.key)})`;
    case "set": {
      const args = [
        JSON.stringify(command.key),
        command.keepValue ? "value" : kvLiteral(command.value),
      ];
      if (command.ttl !== undefined && command.ttl !== null) {
        args.push(JSON.stringify(command.ttl));
      }
      return `set(${args.join(", ")})`;
    }
  }
}

function kvLiteral(value: unknown): string {
  if (value !== null && typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2) ?? "null";
    } catch {
      return "null";
    }
  }
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return "null";
  }
}
