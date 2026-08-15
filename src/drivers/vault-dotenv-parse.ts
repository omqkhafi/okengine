/**
 * Dotenv-shaped parse/serialise shared by the `env` vault driver and CLI.
 *
 * UI / Console must never call this — resolution belongs to VaultRuntime.
 */

/**
 * Parse dotenv text into a name → value map.
 *
 * @param text - File contents
 */
export function parseDotenv(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key.length > 0) map.set(key, value);
  }
  return map;
}

/**
 * Escape a value for dotenv serialisation.
 *
 * @param value - Cleartext
 */
export function escapeDotenvValue(value: string): string {
  if (/[\s#"'=\\]/.test(value)) {
    return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  }
  return value;
}

/**
 * Serialise a map to dotenv text.
 *
 * @param map - Name → value
 */
export function formatDotenv(map: ReadonlyMap<string, string>): string {
  return (
    [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${escapeDotenvValue(v)}`)
      .join("\n") + (map.size > 0 ? "\n" : "")
  );
}

/**
 * Replace or append one `KEY=value` line. Other lines stay as-is.
 *
 * @param env - Existing dotenv text
 * @param key - Variable name
 * @param value - Cleartext
 */
export function upsertDotenvAssignment(env: string, key: string, value: string): string {
  const line = `${key}=${escapeDotenvValue(value)}`;
  const re = new RegExp(`^#?\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=.*$`, "m");
  if (re.test(env)) return env.replace(re, line);
  const trimmed = env.trimEnd();
  return trimmed.length === 0 ? `${line}\n` : `${trimmed}\n${line}\n`;
}

/**
 * Upsert many assignments into dotenv text without dropping unknown keys.
 *
 * @param env - Existing dotenv text
 * @param values - Keys to write
 */
export function mergeDotenvAssignments(
  env: string,
  values: Readonly<Record<string, string>>,
): string {
  let out = env;
  for (const [key, value] of Object.entries(values)) {
    out = upsertDotenvAssignment(out, key, value);
  }
  return out.endsWith("\n") || out.length === 0 ? out : `${out}\n`;
}
