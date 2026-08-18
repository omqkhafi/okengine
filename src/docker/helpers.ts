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

/** Postgres-protocol env shape (`POSTGRES_*`) — shared by postgres / supabase / timescale. */
export function postgresEnv(s: ServiceSpec): Record<string, string> {
  return {
    POSTGRES_USER: credEnv(s, "USER"),
    POSTGRES_PASSWORD: credEnv(s, "PASSWORD"),
    POSTGRES_DB: credEnv(s, "DB"),
  };
}

/** Postgres-protocol healthcheck — shared by postgres / supabase / timescale. */
export const postgresHealth = {
  test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER"],
  interval: "5s",
  timeout: "3s",
  retries: 10,
} as const;

/**
 * Postmaster flags so `pg_stat_statements` can load (shared memory).
 * Official `postgres` / `pgvector` images — do not use on Supabase/Yugabyte.
 */
export const POSTGRES_STAT_STATEMENTS_COMMAND = [
  "postgres",
  "-c",
  "shared_preload_libraries=pg_stat_statements",
] as const;

/**
 * Timescale images already require `timescaledb` in preload.
 * Keep it first — dropping it breaks `CREATE EXTENSION timescaledb` / hypertables.
 */
export const TIMESCALE_STAT_STATEMENTS_COMMAND = [
  "postgres",
  "-c",
  "shared_preload_libraries=timescaledb,pg_stat_statements",
] as const;

/** CockroachDB single-node env (`COCKROACH_*`) — used only when the data dir is empty. */
export function cockroachEnv(s: ServiceSpec): Record<string, string> {
  return {
    COCKROACH_USER: credEnv(s, "USER"),
    COCKROACH_PASSWORD: credEnv(s, "PASSWORD"),
    COCKROACH_DATABASE: credEnv(s, "DB"),
  };
}

/** CockroachDB readiness — DB Console `/health?ready=1`. */
export const cockroachHealth = {
  test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/health?ready=1 >/dev/null 2>&1 || exit 1"],
  interval: "5s",
  timeout: "5s",
  retries: 20,
  start_period: "15s",
} as const;

/** YugabyteDB YSQL env — `YSQL_PASSWORD` enables authentication automatically. */
export function yugabyteEnv(s: ServiceSpec): Record<string, string> {
  return {
    YSQL_USER: credEnv(s, "USER"),
    YSQL_PASSWORD: credEnv(s, "PASSWORD"),
    YSQL_DB: credEnv(s, "DB"),
  };
}

/** YugabyteDB YSQL readiness — cluster boot is slow; long `start_period`. */
export const yugabyteHealth = {
  test: [
    "CMD-SHELL",
    'PGPASSWORD="$$YSQL_PASSWORD" bin/ysqlsh -h 127.0.0.1 -p 5433 -U "$$YSQL_USER" -d "$$YSQL_DB" -c "SELECT 1" >/dev/null 2>&1 || exit 1',
  ],
  interval: "10s",
  timeout: "10s",
  retries: 30,
  start_period: "90s",
} as const;

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

/** Compose role for `{ durable: true }` KV — second Redis-family service. */
export const STORE_KV_DURABLE_ROLE = "store.kv.durable" as const;

/**
 * Whether this spec is the durable KV companion (volume + AOF/snapshot flags).
 *
 * @param role - Compose role key
 */
export function isDurableKvRole(role: string): boolean {
  return role === STORE_KV_DURABLE_ROLE;
}

/**
 * `redis-server` / `valkey-server` command — role-prefixed password; durable
 * role adds `--dir /data` and env-gated AOF (`APPENDONLY` defaults `no`).
 *
 * @param spec - Service
 * @param binary - Server binary
 */
export function kvServerCommand(
  spec: ServiceSpec,
  binary: "redis-server" | "valkey-server",
): string {
  const p = envPrefix(spec.role);
  const pass = `$$${p}_PASSWORD`;
  const memory = `--maxmemory "$$\{${p}_MAXMEMORY:-0}" --maxmemory-policy "$$\{${p}_MAXMEMORY_POLICY:-noeviction}"`;
  if (isDurableKvRole(spec.role)) {
    return `exec ${binary} --requirepass "${pass}" --dir /data --appendonly "$$\{${p}_APPENDONLY:-no}" --appendfsync "$$\{${p}_APPENDFSYNC:-everysec}" ${memory}`;
  }
  return `exec ${binary} --requirepass "${pass}" ${memory}`;
}

/**
 * Dragonfly command — durable role mounts `/data` and env-gates `snapshot_cron`.
 *
 * @param spec - Service
 */
export function dragonflyServerCommand(spec: ServiceSpec): string {
  const p = envPrefix(spec.role);
  const pass = `$$${p}_PASSWORD`;
  const memory = `--maxmemory "$$\{${p}_MAXMEMORY:-0}"`;
  if (isDurableKvRole(spec.role)) {
    return `exec dragonfly --requirepass "${pass}" --dir /data --dbfilename dump --snapshot_cron "$$\{${p}_SNAPSHOT_CRON:-}" ${memory}`;
  }
  return `exec dragonfly --requirepass "${pass}" ${memory}`;
}

/**
 * Named volume for the durable KV data dir (`store-kv-durable-data:/data`).
 *
 * @param spec - Service
 */
export function durableKvVolume(spec: ServiceSpec): string[] {
  if (!isDurableKvRole(spec.role)) return [];
  return [`${spec.serviceName}-data:/data`];
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
  if (role === STORE_KV_DURABLE_ROLE) return 6380;
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

/** Preferred top-level key order for Compose documents. */
const COMPOSE_TOP_LEVEL_ORDER = [
  "name",
  "networks",
  "services",
  "volumes",
  "secrets",
  "configs",
] as const;

/**
 * Options for {@link composeToYaml}.
 */
export type ComposeYamlOptions = {
  /**
   * File header comments (without leading `# ` prefix — pass full `# …` lines).
   * Pass an empty array to omit the header.
   */
  readonly header?: readonly string[];
  /**
   * Per-service comment body (without `#`). When set, each service is preceded
   * by `  # <comment>` and a blank line separates services.
   */
  readonly serviceComment?: (serviceName: string) => string | undefined;
};

/**
 * Render a Compose document with readable gaps: blank lines between top-level
 * sections and between services, plus optional per-service comments.
 *
 * @param doc - Compose mapping (`name`, `networks`, `services`, …)
 * @param options - Header / service comment hooks
 */
export function composeToYaml(
  doc: Readonly<Record<string, unknown>>,
  options: ComposeYamlOptions = {},
): string {
  const header = options.header ?? [
    "# Generated by `oke docker` / `oke dev --docker`.",
    "# Local overrides: docker-compose.override.yml (do not commit secrets).",
  ];
  const lines: string[] = [...header];
  if (header.length > 0) lines.push("");

  const present = Object.keys(doc).filter((k) => doc[k] !== undefined);
  const ordered = [
    ...COMPOSE_TOP_LEVEL_ORDER.filter((k) => present.includes(k)),
    ...present.filter((k) => !(COMPOSE_TOP_LEVEL_ORDER as readonly string[]).includes(k)),
  ];

  for (let i = 0; i < ordered.length; i++) {
    const key = ordered[i]!;
    const value = doc[key];
    if (i > 0) lines.push("");

    if (key === "services" && isPlainObject(value)) {
      lines.push("services:");
      const services = Object.entries(value).filter(([, v]) => v !== undefined);
      for (let j = 0; j < services.length; j++) {
        const [name, body] = services[j]!;
        if (j > 0) lines.push("");
        const comment = options.serviceComment?.(name);
        if (comment) lines.push(`  # ${comment}`);
        if (body !== null && typeof body === "object") {
          const nested = toYaml(body, 2);
          if (nested === "{}" || nested === "[]") {
            lines.push(`  ${name}: ${nested}`);
          } else {
            lines.push(`  ${name}:`);
            lines.push(nested);
          }
        } else {
          lines.push(`  ${name}: ${toYaml(body, 0)}`);
        }
      }
      continue;
    }

    if (value !== null && typeof value === "object") {
      const nested = toYaml(value, 1);
      if (nested === "{}" || nested === "[]") {
        lines.push(`${key}: ${nested}`);
      } else {
        lines.push(`${key}:`);
        lines.push(nested);
      }
    } else {
      lines.push(`${key}: ${toYaml(value, 0)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
