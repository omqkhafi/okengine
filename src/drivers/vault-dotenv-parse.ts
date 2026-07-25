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
