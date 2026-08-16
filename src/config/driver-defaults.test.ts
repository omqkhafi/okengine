/**
 * Driver-map defaults — per-key merge onto the real established defaults,
 * never a whole-object replace and never leaking across driver maps.
 */

import { describe, expect, test } from "bun:test";
import { mergeEnvDriverMap } from "./index.ts";
import {
  CHANNEL_EMAIL_DEFAULTS,
  CHANNEL_SMS_DEFAULTS,
  CLOCK_DEFAULTS,
  JOURNAL_DEFAULTS,
  resolveEffectiveDrivers,
  RUNS_DEFAULTS,
  SIGNAL_DEFAULTS,
  STORE_FILES_DEFAULTS,
  STORE_KV_DEFAULTS,
  STORE_SQL_DEFAULTS,
  VAULT_DEFAULTS,
} from "./driver-defaults.ts";

describe("mergeEnvDriverMap", () => {
  test("an unset key keeps the real default, not a sibling key's value", () => {
    const merged = mergeEnvDriverMap({ test: "pglite" }, STORE_SQL_DEFAULTS);
    expect(merged).toEqual({
      dev: "postgres",
      test: "pglite",
      prod: "postgres",
    });
  });

  test("undefined override yields the untouched default map", () => {
    expect(mergeEnvDriverMap(undefined, STORE_KV_DEFAULTS)).toEqual(STORE_KV_DEFAULTS);
  });

  test("a fully-specified override wins on every key", () => {
    const override = { dev: "a", test: "b", prod: "c" };
    expect(mergeEnvDriverMap(override, STORE_SQL_DEFAULTS)).toEqual(override);
  });
});

describe("resolveEffectiveDrivers", () => {
  test("`{ store: { sql: { test: 'pglite' } } }` keeps postgres on dev/prod", () => {
    const effective = resolveEffectiveDrivers({
      store: { sql: { test: "pglite" } },
    });

    expect(effective.store.sql).toEqual({
      dev: "postgres",
      test: "pglite",
      prod: "postgres",
    });
  });

  test("every other driver stays at its full, real, untouched default map", () => {
    const effective = resolveEffectiveDrivers({
      store: { sql: { test: "pglite" } },
    });

    expect(effective.store.kv).toEqual(STORE_KV_DEFAULTS);
    expect(effective.store.files).toEqual(STORE_FILES_DEFAULTS);
    expect(effective.signal).toEqual(SIGNAL_DEFAULTS);
    expect(effective.clock).toEqual(CLOCK_DEFAULTS);
    expect(effective.journal).toEqual(JOURNAL_DEFAULTS);
    expect(effective.vault).toEqual(VAULT_DEFAULTS);
    expect(effective.channel.email).toEqual(CHANNEL_EMAIL_DEFAULTS);
    expect(effective.channel.sms).toEqual(CHANNEL_SMS_DEFAULTS);
    expect(effective.runs).toEqual(RUNS_DEFAULTS);
  });

  test("overriding one driver's map has zero effect on a sibling driver's defaults", () => {
    const effective = resolveEffectiveDrivers({
      store: { kv: { dev: "redis" } },
    });

    expect(effective.store.kv).toEqual({
      dev: "redis",
      test: "memory",
      prod: "redis",
    });
    expect(effective.store.sql).toEqual(STORE_SQL_DEFAULTS);
    expect(effective.store.files).toEqual(STORE_FILES_DEFAULTS);
    expect(effective.signal).toEqual(SIGNAL_DEFAULTS);
    expect(effective.vault).toEqual(VAULT_DEFAULTS);
  });

  test("overriding one env key leaves the other two at real defaults for that driver", () => {
    const effective = resolveEffectiveDrivers({
      vault: { dev: "keychain" },
    });

    expect(effective.vault).toEqual({
      dev: "keychain",
      test: "memory",
      prod: "vault",
    });
  });

  test("no drivers config at all yields the real, untouched defaults for every map", () => {
    const effective = resolveEffectiveDrivers(undefined);
    expect(effective).toEqual({
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
    });
  });
});
