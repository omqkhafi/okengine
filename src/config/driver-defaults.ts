/**
 * Real, already-established default driver ids per {@link ConfigEnv} —
 * one source of truth for every driver map that has a single default table.
 *
 * Philosophy: we test on what we deploy. `dev`/`prod` share production
 * protocols (Postgres, Redis, …); `test` uses PGLite for SQL and memory
 * drivers where the protocol is simple.
 *
 * `store.index`, `channel.whatsapp` / `push`, and `ai` are intentionally
 * absent — they don't have one established default across all three envs
 * and keep using {@link resolveDriverId}'s legacy cascade.
 * @module
 */

import {
  mergeEnvDriverMap,
  normalizeEnvDriverMap,
  type DriversConfig,
  type EnvDriverMap,
  type EnvDriverInput,
} from "./index.ts";

/** `drivers.store.sql` — Postgres for dev/prod, PGLite for test. */
export const STORE_SQL_DEFAULTS: EnvDriverMap = {
  dev: "postgres",
  test: "pglite",
  prod: "postgres",
};

/** `drivers.store.kv` — Redis for dev/prod, in-memory for test. */
export const STORE_KV_DEFAULTS: EnvDriverMap = {
  dev: "redis",
  test: "memory",
  prod: "redis",
};

/** `drivers.store.files` — S3 for dev/prod, in-memory for test. */
export const STORE_FILES_DEFAULTS: EnvDriverMap = {
  dev: "s3",
  test: "memory",
  prod: "s3",
};

/** `drivers.signal` — Redis for dev/prod, in-memory for test. */
export const SIGNAL_DEFAULTS: EnvDriverMap = {
  dev: "redis",
  test: "memory",
  prod: "redis",
};

/** `drivers.clock` — Postgres cron for dev/prod, frozen clock in test. */
export const CLOCK_DEFAULTS: EnvDriverMap = {
  dev: "postgres",
  test: "frozen",
  prod: "postgres",
};

/** `drivers.journal` — Postgres for dev/prod, in-memory for test. */
export const JOURNAL_DEFAULTS: EnvDriverMap = {
  dev: "postgres",
  test: "memory",
  prod: "postgres",
};

/**
 * `drivers.vault` — OS env vars in dev, in-memory for test, and the built-in
 * encrypted-at-rest store in prod (env layers still resolve first).
 */
export const VAULT_DEFAULTS: EnvDriverMap = {
  dev: "env",
  test: "memory",
  prod: "vault",
};

/** `drivers.channel.email` — SMTP for dev/prod, console inbox for test. */
export const CHANNEL_EMAIL_DEFAULTS: EnvDriverMap = {
  dev: "smtp",
  test: "console",
  prod: "smtp",
};

/**
 * `drivers.channel.sms` — no default provider in any env; SMS is opt-in
 * only (an unconfigured env simply gets no SMS channel).
 */
export const CHANNEL_SMS_DEFAULTS: EnvDriverMap = {};

/**
 * `drivers.runs` — Parquet + DuckDB for `dev`/`prod` (`.oke/runs`);
 * in-memory for `test`. Recording stays opt-in in prod; this is the
 * driver when a runs store is bound.
 */
export const RUNS_DEFAULTS: EnvDriverMap = {
  dev: "files",
  test: "memory",
  prod: "files",
};

/** Every driver map with one established default table, grouped by element. */
export const DRIVER_DEFAULTS = {
  store: {
    sql: STORE_SQL_DEFAULTS,
    kv: STORE_KV_DEFAULTS,
    files: STORE_FILES_DEFAULTS,
  },
  signal: SIGNAL_DEFAULTS,
  clock: CLOCK_DEFAULTS,
  journal: JOURNAL_DEFAULTS,
  vault: VAULT_DEFAULTS,
  channel: {
    email: CHANNEL_EMAIL_DEFAULTS,
    sms: CHANNEL_SMS_DEFAULTS,
  },
  runs: RUNS_DEFAULTS,
} as const;

/**
 * Every driver map from {@link DRIVER_DEFAULTS}, fully resolved — the
 * developer's `oke.config.ts` override merged onto the real default,
 * per-key, for all three {@link ConfigEnv} slots at once. This is the "full
 * picture" `oke doctor` prints: what boot actually uses for every env, even
 * when the config on disk only pins one key.
 */
export interface EffectiveDriversConfig {
  readonly store: {
    readonly sql: EnvDriverMap;
    readonly kv: EnvDriverMap;
    readonly files: EnvDriverMap;
  };
  readonly signal: EnvDriverMap;
  readonly clock: EnvDriverMap;
  readonly journal: EnvDriverMap;
  readonly vault: EnvDriverMap;
  readonly channel: {
    readonly email: EnvDriverMap;
    readonly sms: EnvDriverMap;
  };
  readonly runs: EnvDriverMap;
}

/**
 * Merge every driver map in {@link DRIVER_DEFAULTS} against the matching
 * slot of a loaded `oke.config.ts` `drivers` block.
 *
 * @param drivers - `drivers` block from a loaded `oke.config.ts` (already
 *   normalized if it came through `defineConfig`; normalized again here so
 *   an un-normalized/raw block is still handled)
 */
export function resolveEffectiveDrivers(
  drivers: DriversConfig | undefined,
): EffectiveDriversConfig {
  const merge = (map: EnvDriverInput | undefined, defaults: EnvDriverMap) =>
    mergeEnvDriverMap(normalizeEnvDriverMap(map), defaults);
  return {
    store: {
      sql: merge(drivers?.store?.sql, STORE_SQL_DEFAULTS),
      kv: merge(drivers?.store?.kv, STORE_KV_DEFAULTS),
      files: merge(drivers?.store?.files, STORE_FILES_DEFAULTS),
    },
    signal: merge(drivers?.signal, SIGNAL_DEFAULTS),
    clock: merge(drivers?.clock, CLOCK_DEFAULTS),
    journal: merge(drivers?.journal, JOURNAL_DEFAULTS),
    vault: merge(drivers?.vault, VAULT_DEFAULTS),
    channel: {
      email: merge(drivers?.channel?.email, CHANNEL_EMAIL_DEFAULTS),
      sms: merge(drivers?.channel?.sms, CHANNEL_SMS_DEFAULTS),
    },
    runs: merge(drivers?.runs, RUNS_DEFAULTS),
  };
}
