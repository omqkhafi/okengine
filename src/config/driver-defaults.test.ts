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
  SIGNAL_DEFAULTS,
  STORE_FILES_DEFAULTS,
  STORE_KV_DEFAULTS,
  STORE_SQL_DEFAULTS,
  VAULT_DEFAULTS,
} from "./driver-defaults.ts";

describe("mergeEnvDriverMap", () => {
  test("an unset key keeps the real default, not a sibling key's value", () => {
    const merged = mergeEnvDriverMap({ local: "pglite" }, STORE_SQL_DEFAULTS);
    expect(merged).toEqual({
      local: "pglite",
      docker: "postgres",
      test: "memory",
      prod: "postgres",
    });
  });

  test("undefined override yields the untouched default map", () => {
    expect(mergeEnvDriverMap(undefined, STORE_KV_DEFAULTS)).toEqual(STORE_KV_DEFAULTS);
  });

  test("a fully-specified override wins on every key", () => {
    const override = { local: "a", docker: "b", test: "c", prod: "d" };
    expect(mergeEnvDriverMap(override, STORE_SQL_DEFAULTS)).toEqual(override);
  });
});

describe("resolveEffectiveDrivers — the drivers.store.sql.local discussion scenario", () => {
  test("`{ store: { sql: { local: 'pglite' } } }` resolves sql to the real map, pglite only on local", () => {
    const effective = resolveEffectiveDrivers({
      store: { sql: { local: "pglite" } },
    });

    expect(effective.store.sql).toEqual({
      local: "pglite",
      docker: "postgres",
      test: "memory",
      prod: "postgres",
    });
  });

  test("every other driver stays at its full, real, untouched default map", () => {
    const effective = resolveEffectiveDrivers({
      store: { sql: { local: "pglite" } },
    });

    expect(effective.store.kv).toEqual(STORE_KV_DEFAULTS);
    expect(effective.store.files).toEqual(STORE_FILES_DEFAULTS);
    expect(effective.signal).toEqual(SIGNAL_DEFAULTS);
    expect(effective.clock).toEqual(CLOCK_DEFAULTS);
    expect(effective.journal).toEqual(JOURNAL_DEFAULTS);
    expect(effective.vault).toEqual(VAULT_DEFAULTS);
    expect(effective.channel.email).toEqual(CHANNEL_EMAIL_DEFAULTS);
    expect(effective.channel.sms).toEqual(CHANNEL_SMS_DEFAULTS);
  });

  test("overriding one driver's map has zero effect on a sibling driver's defaults", () => {
    const effective = resolveEffectiveDrivers({
      store: { kv: { local: "redis" } },
    });

    // The overridden driver (kv) reflects the override on its one set key.
    expect(effective.store.kv).toEqual({
      local: "redis",
      docker: "redis",
      test: "memory",
      prod: "redis",
    });
    // sql / files (same element, different facet) stay fully at real defaults.
    expect(effective.store.sql).toEqual(STORE_SQL_DEFAULTS);
    expect(effective.store.files).toEqual(STORE_FILES_DEFAULTS);
    // Unrelated elements stay fully at real defaults too.
    expect(effective.signal).toEqual(SIGNAL_DEFAULTS);
    expect(effective.vault).toEqual(VAULT_DEFAULTS);
  });

  test("overriding one env key leaves the other three at real defaults for that driver", () => {
    const effective = resolveEffectiveDrivers({
      vault: { local: "keychain" },
    });

    expect(effective.vault).toEqual({
      local: "keychain",
      docker: "env",
      test: "memory",
      prod: "env",
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
    });
  });
});
