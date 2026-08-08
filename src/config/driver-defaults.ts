/**
 * Real, already-established default driver ids per {@link ConfigEnv} —
 * one source of truth for every driver map that has a single default table.
 *
 * These mirror the literal fallbacks that used to live inline in each
 * `src/kernel/boot-bind/*.ts` resolver (`docker ? "postgres" : "memory"`,
 * `env === "test" ? "frozen" : "memory"`, …). Kept here so
 * {@link mergeEnvDriverMap} has one real map to merge a developer's partial
 * override onto, instead of every resolver re-deriving its own default.
 *
 * `store.index`, `channel.whatsapp` / `push`, and `ai` are intentionally
 * absent — they don't have one established default across all four envs
 * (index/whatsapp/push default to nothing until configured; ai has no prod
 * default at all and must be declared) and keep using
 * {@link resolveDriverId}'s legacy cascade.
 * @module
 */

import {
  mergeEnvDriverMap,
  normalizeEnvDriverMap,
  type DriversConfig,
  type EnvDriverMap,
  type RawEnvDriverMap,
} from "./index.ts";

/** `drivers.store.sql` — Postgres for docker/prod, in-memory otherwise. */
export const STORE_SQL_DEFAULTS: EnvDriverMap = {
  local: "memory",
  docker: "postgres",
  test: "memory",
  prod: "postgres",
};

/** `drivers.store.kv` — Redis for docker/prod, in-memory otherwise. */
export const STORE_KV_DEFAULTS: EnvDriverMap = {
  local: "memory",
  docker: "redis",
  test: "memory",
  prod: "redis",
};

/** `drivers.store.files` — S3 for docker/prod, in-memory otherwise. */
export const STORE_FILES_DEFAULTS: EnvDriverMap = {
  local: "memory",
  docker: "s3",
  test: "memory",
  prod: "s3",
};

/** `drivers.signal` — in-memory bus everywhere. */
export const SIGNAL_DEFAULTS: EnvDriverMap = {
  local: "memory",
  docker: "memory",
  test: "memory",
  prod: "memory",
};

/** `drivers.clock` — frozen test clock in `test`, in-memory cron elsewhere. */
export const CLOCK_DEFAULTS: EnvDriverMap = {
  local: "memory",
  docker: "memory",
  test: "frozen",
  prod: "memory",
};

/** `drivers.journal` — in-memory durable-run store everywhere. */
export const JOURNAL_DEFAULTS: EnvDriverMap = {
  local: "memory",
  docker: "memory",
  test: "memory",
  prod: "memory",
};

/** `drivers.vault` — OS env vars everywhere except `test` (in-memory). */
export const VAULT_DEFAULTS: EnvDriverMap = {
  local: "env",
  docker: "env",
  test: "memory",
  prod: "env",
};

/** `drivers.channel.email` — SMTP for docker/prod, console inbox otherwise. */
export const CHANNEL_EMAIL_DEFAULTS: EnvDriverMap = {
  local: "console",
  docker: "smtp",
  test: "console",
  prod: "smtp",
};

/**
 * `drivers.channel.sms` — no default provider in any env; SMS is opt-in
 * only (an unconfigured env simply gets no SMS channel).
 */
export const CHANNEL_SMS_DEFAULTS: EnvDriverMap = {};

/**
 * Effective default map for a driver whose real default also depends on the
 * boot-time `docker` flag (real docker-compose infra available), not just
 * the active {@link ConfigEnv} key — `store.sql` / `store.kv` /
 * `store.files` / `channel.email` / the Gate KV facet. Real usage always
 * pairs `docker: true` with `env: "docker"` / `"prod"`, so the static table
 * (`docker`/`prod` → real infra id) applies as-is; with the flag `false`
 * (`oke dev -l`, `test`, or a boot that deliberately decouples `env` from
 * infra availability) every key falls back to the same safe, no-external-
 * deps id the real table already uses for `test`.
 *
 * @param defaults - Real per-env default table (its `docker`/`prod` slots
 *   assume real infra is actually up)
 * @param docker - Boot-time docker/compose-infra flag
 */
export function dockerFlagDefaults(defaults: EnvDriverMap, docker: boolean): EnvDriverMap {
  if (docker) return defaults;
  const safe = defaults.test;
  return { local: safe, docker: safe, test: safe, prod: safe };
}

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
} as const;

/**
 * Every driver map from {@link DRIVER_DEFAULTS}, fully resolved — the
 * developer's `oke.config.ts` override merged onto the real default,
 * per-key, for all four {@link ConfigEnv} slots at once. This is the "full
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
  const merge = (map: EnvDriverMap | undefined, defaults: EnvDriverMap) =>
    mergeEnvDriverMap(normalizeEnvDriverMap(map as RawEnvDriverMap), defaults);
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
  };
}
