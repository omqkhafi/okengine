/**
 * PgDog image recipe — Postgres wire-protocol connection pooler.
 *
 * Sits in front of the `postgres` recipe. Transaction pooling is set
 * explicitly (`pooler_mode = "transaction"` — also PgDog's upstream default).
 * Config shape matches upstream docs under `pgdog/`:
 * `pgdog/pgdog.toml` + `pgdog/users.toml`
 * (https://docs.pgdog.dev/configuration/).
 */

/** Relative directory for generated PgDog TOML (under the compose dir). */
export const PGDOG_CONFIG_DIR = "pgdog";

import type { ImageRecipe } from "../types.ts";

/** Backend Postgres service name in the compose network. */
export const PGDOG_BACKEND_SERVICE = "store-sql";

/**
 * Build `pgdog.toml` — general listen settings + one primary database.
 *
 * @param opts - Database name clients use + Postgres host on the compose network
 */
export function buildPgDogToml(opts: {
  readonly database: string;
  readonly postgresHost?: string;
  /** Backend container port (`store-sql` recipe port; default 5432). */
  readonly postgresPort?: number;
}): string {
  const host = opts.postgresHost ?? PGDOG_BACKEND_SERVICE;
  const port = opts.postgresPort ?? 5432;
  const db = opts.database;
  return [
    "[general]",
    'host = "0.0.0.0"',
    "port = 6432",
    'pooler_mode = "transaction"',
    "",
    "[[databases]]",
    `name = ${tomlString(db)}`,
    `host = ${tomlString(host)}`,
    `port = ${port}`,
    `database_name = ${tomlString(db)}`,
    "",
  ].join("\n");
}

/**
 * Build `users.toml` — one user/database pair (same creds as Postgres).
 *
 * @param opts - Client/server credentials
 */
export function buildPgDogUsersToml(opts: {
  readonly user: string;
  readonly password: string;
  readonly database: string;
}): string {
  return [
    "[[users]]",
    `name = ${tomlString(opts.user)}`,
    `password = ${tomlString(opts.password)}`,
    `database = ${tomlString(opts.database)}`,
    "",
  ].join("\n");
}

/** PgDog pooler. Postgres wire protocol on 6432. */
export const pgdog: ImageRecipe = {
  id: "pgdog",
  port: 6432,
  match: (i) => /pgdog/i.test(i),
  apply: () => ({
    volumes: [
      `./${PGDOG_CONFIG_DIR}/pgdog.toml:/pgdog/pgdog.toml:ro`,
      `./${PGDOG_CONFIG_DIR}/users.toml:/pgdog/users.toml:ro`,
    ],
    dependsOn: {
      [PGDOG_BACKEND_SERVICE]: { condition: "service_healthy" },
    },
    healthcheck: {
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -p 6432 || exit 1"],
      interval: "5s",
      timeout: "3s",
      retries: 12,
      start_period: "5s",
    },
  }),
  url: (_s, c) =>
    `postgres://${c.user}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${c.database}`,
};

function tomlString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
