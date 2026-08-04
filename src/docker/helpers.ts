/**
 * Shared helpers for image recipes — keep recipe files ≤15 lines.
 */

import type { ServiceSpec } from "./types.ts";

/**
 * Env-var *reference* for a credential field — value never enters YAML.
 *
 * @param spec - Service
 * @param field - USER | PASSWORD | DB
 */
export function credEnv(spec: ServiceSpec, field: "USER" | "PASSWORD" | "DB"): string {
  const key = `OKE_${spec.role.replaceAll(".", "_").toUpperCase()}_${field}`;
  return `\${${key}}`;
}

/**
 * Compose service name for a role (`store.sql` → `store-sql`).
 *
 * @param role - Role key
 */
export function serviceNameFor(role: string): string {
  return role.replaceAll(".", "-");
}

/**
 * Env key prefix for a role (`store.sql` → `OKE_STORE_SQL`).
 *
 * @param role - Role key
 */
export function envPrefix(role: string): string {
  return `OKE_${role.replaceAll(".", "_").toUpperCase()}`;
}

/**
 * Default host port for well-known roles.
 *
 * @param role - Role key
 * @param containerPort - Container port
 */
export function defaultHostPort(role: string, containerPort: number): number {
  if (role === "store.sql") return 5432;
  if (role === "store.kv") return 6379;
  if (role === "signal") return 4222;
  if (role === "pgdog") return 6432;
  if (role === "proxy") return 80;
  return containerPort;
}

/**
 * Escape a YAML double-quoted string.
 *
 * @param value - Raw string
 */
export function yamlQuote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * Render a plain YAML mapping (2-space indent, no library).
 *
 * @param value - JSON-like structure
 * @param indent - Current indent level
 */
export function toYaml(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return yamlQuote(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        if (item !== null && typeof item === "object" && !Array.isArray(item)) {
          const body = toYaml(item, indent + 1);
          const lines = body.split("\n");
          const first = lines[0] ?? "";
          const rest = lines
            .slice(1)
            .map((l) => `${pad}  ${l}`)
            .join("\n");
          return rest ? `${pad}- ${first}\n${rest}` : `${pad}- ${first}`;
        }
        return `${pad}- ${toYaml(item, 0)}`;
      })
      .join("\n");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    );
    if (entries.length === 0) return "{}";
    return entries
      .map(([k, v]) => {
        if (v !== null && typeof v === "object") {
          const nested = toYaml(v, indent + 1);
          if (nested === "{}" || nested === "[]") return `${pad}${k}: ${nested}`;
          return `${pad}${k}:\n${nested}`;
        }
        return `${pad}${k}: ${toYaml(v, 0)}`;
      })
      .join("\n");
  }
  return yamlQuote(String(value));
}
