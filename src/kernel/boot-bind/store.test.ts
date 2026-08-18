/**
 * Store binder — docker profile (+ env overrides).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { files, store } from "../../elements/store.ts";
import {
  bindStore,
  indexDriverFor,
  resetFilesFsWarnForTests,
  resetKvDurableWarnsForTests,
  resolveFilesDriverId,
  resolveIndexDriverId,
  resolveKvDriverId,
  resolveSqlDriverId,
} from "./store.ts";

describe("bindStore driver resolution", () => {
  const prev = {
    docker: process.env.OKE_DOCKER,
    sql: process.env.OKE_SQL_DRIVER,
    kv: process.env.OKE_KV_DRIVER,
    files: process.env.OKE_FILES_DRIVER,
    index: process.env.OKE_INDEX_DRIVER,
  };

  afterEach(() => {
    if (prev.docker === undefined) delete process.env.OKE_DOCKER;
    else process.env.OKE_DOCKER = prev.docker;
    if (prev.sql === undefined) delete process.env.OKE_SQL_DRIVER;
    else process.env.OKE_SQL_DRIVER = prev.sql;
    if (prev.kv === undefined) delete process.env.OKE_KV_DRIVER;
    else process.env.OKE_KV_DRIVER = prev.kv;
    if (prev.files === undefined) delete process.env.OKE_FILES_DRIVER;
    else process.env.OKE_FILES_DRIVER = prev.files;
    if (prev.index === undefined) delete process.env.OKE_INDEX_DRIVER;
    else process.env.OKE_INDEX_DRIVER = prev.index;
  });

  test("test env keeps pglite / memory / fs from config", () => {
    const options = {
      config: {
        drivers: {
          store: {
            sql: { dev: "postgres", test: "pglite", prod: "postgres" },
            kv: { dev: "redis", test: "memory", prod: "redis" },
            files: { dev: "s3", test: "fs", prod: "s3" },
          },
        },
      },
    };
    expect(resolveSqlDriverId(options, "test", false)).toBe("pglite");
    expect(resolveKvDriverId(options, "test", false)).toBe("memory");
    expect(resolveFilesDriverId(options, "test", false)).toBe("fs");
  });

  test("dev env uses compose profile (falls back to prod)", () => {
    const options = {
      config: {
        drivers: {
          store: {
            sql: { dev: "postgres", test: "pglite", prod: "postgres" },
            kv: { dev: "redis", test: "memory", prod: "redis" },
            files: { dev: "s3", test: "fs", prod: "s3" },
          },
        },
      },
    };
    expect(resolveSqlDriverId(options, "dev", true)).toBe("postgres");
    expect(resolveKvDriverId(options, "dev", true)).toBe("redis");
    expect(resolveFilesDriverId(options, "dev", true)).toBe("s3");
  });

  test("docker mode honours OKE_*_DRIVER overrides", () => {
    process.env.OKE_SQL_DRIVER = "postgres";
    process.env.OKE_KV_DRIVER = "redis";
    process.env.OKE_FILES_DRIVER = "s3";
    expect(resolveSqlDriverId({}, "dev", true)).toBe("postgres");
    expect(resolveKvDriverId({}, "dev", true)).toBe("redis");
    expect(resolveFilesDriverId({}, "dev", true)).toBe("s3");
  });

  test("pinning only `test` never leaks into dev/prod — each keeps its real default", () => {
    const options = {
      config: {
        drivers: {
          store: {
            sql: { test: "pglite" },
          },
        },
      },
    };
    expect(resolveSqlDriverId(options, "test", false)).toBe("pglite");
    expect(resolveSqlDriverId(options, "dev", true)).toBe("postgres");
    expect(resolveSqlDriverId(options, "prod", true)).toBe("postgres");
    // kv / files are untouched by the sql-only override.
    expect(resolveKvDriverId(options, "test", false)).toBe("memory");
    expect(resolveKvDriverId(options, "dev", true)).toBe("redis");
  });
});

describe("bindStore durable KV routing", () => {
  const prev = {
    redis: process.env.REDIS_URL,
    kv: process.env.OKE_STORE_KV_URL,
    durable: process.env.OKE_STORE_KV_DURABLE_URL,
    durableAlias: process.env.REDIS_DURABLE_URL,
  };

  afterEach(() => {
    resetKvDurableWarnsForTests();
    if (prev.redis === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prev.redis;
    if (prev.kv === undefined) delete process.env.OKE_STORE_KV_URL;
    else process.env.OKE_STORE_KV_URL = prev.kv;
    if (prev.durable === undefined) delete process.env.OKE_STORE_KV_DURABLE_URL;
    else process.env.OKE_STORE_KV_DURABLE_URL = prev.durable;
    if (prev.durableAlias === undefined) delete process.env.REDIS_DURABLE_URL;
    else process.env.REDIS_DURABLE_URL = prev.durableAlias;
  });

  test("memory + durable in test does not throw or warn", () => {
    const warnings: string[] = [];
    const prevWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      bindStore(
        { stores: [store.kv("ledger", { durable: true })] },
        "test",
        () => Date.now(),
        false,
      );
      expect(warnings.some((w) => w.includes("durable"))).toBe(false);
    } finally {
      console.warn = prevWarn;
    }
  });

  test("redis + durable without URL throws outside test", () => {
    delete process.env.OKE_STORE_KV_DURABLE_URL;
    delete process.env.REDIS_DURABLE_URL;
    process.env.REDIS_URL = "redis://cache";
    expect(() =>
      bindStore(
        {
          stores: [store.kv("ledger", { durable: true })],
          config: {
            drivers: {
              store: {
                sql: { dev: "memory", test: "memory", prod: "memory" },
                kv: { dev: "redis", test: "memory", prod: "redis" },
              },
            },
          },
        },
        "dev",
        () => Date.now(),
        false,
      ),
    ).toThrow(/OKE_STORE_KV_DURABLE_URL/);
  });

  test("redis + cache-shaped KV warns once outside test", () => {
    process.env.REDIS_URL = "redis://cache";
    const warnings: string[] = [];
    const prevWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const options = {
        stores: [store.kv("sessions")],
        config: {
          drivers: {
            store: {
              sql: { dev: "memory", test: "memory", prod: "memory" },
              kv: { dev: "redis", test: "memory", prod: "redis" },
            },
          },
        },
      };
      bindStore(options, "dev", () => Date.now(), false);
      bindStore(options, "dev", () => Date.now(), false);
      expect(warnings.filter((w) => w.includes("cache-shaped"))).toHaveLength(1);
    } finally {
      console.warn = prevWarn;
    }
  });

  test("same cache and durable URL warns once", () => {
    process.env.REDIS_URL = "redis://shared";
    process.env.OKE_STORE_KV_DURABLE_URL = "redis://shared";
    const warnings: string[] = [];
    const prevWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      bindStore(
        {
          stores: [store.kv("sessions"), store.kv("ledger", { durable: true })],
          config: {
            drivers: {
              store: {
                sql: { dev: "memory", test: "memory", prod: "memory" },
                kv: { dev: "redis", test: "memory", prod: "redis" },
              },
            },
          },
        },
        "dev",
        () => Date.now(),
        false,
      );
      expect(warnings.some((w) => w.includes("same"))).toBe(true);
    } finally {
      console.warn = prevWarn;
    }
  });

  test("Dragonfly durable pin warns snapshot RPO", () => {
    process.env.REDIS_URL = "redis://cache";
    process.env.OKE_STORE_KV_DURABLE_URL = "redis://durable";
    const warnings: string[] = [];
    const prevWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      bindStore(
        {
          stores: [store.kv("ledger", { durable: true })],
          config: {
            drivers: {
              store: {
                sql: { dev: "memory", test: "memory", prod: "memory" },
                kv: { dev: "redis", test: "memory", prod: "redis" },
              },
            },
            images: { store: { kvDurable: "docker.dragonflydb.io/dragonflydb/dragonfly" } },
          },
        },
        "dev",
        () => Date.now(),
        false,
      );
      expect(warnings.some((w) => w.includes("Dragonfly") && w.includes("snapshot"))).toBe(true);
    } finally {
      console.warn = prevWarn;
    }
  });

  test("memory + durable in dev warns that memory cannot honor durability", () => {
    const warnings: string[] = [];
    const prevWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      bindStore(
        {
          stores: [store.kv("ledger", { durable: true })],
          config: {
            drivers: {
              store: {
                sql: { dev: "memory", test: "memory", prod: "memory" },
                kv: { dev: "memory", test: "memory", prod: "redis" },
              },
            },
          },
        },
        "dev",
        () => Date.now(),
        false,
      );
      expect(warnings.some((w) => w.includes("memory") && w.includes("durable"))).toBe(true);
    } finally {
      console.warn = prevWarn;
    }
  });
});

describe("bindStore files fs multi-instance warn", () => {
  afterEach(() => {
    resetFilesFsWarnForTests();
  });

  test("warns once when files driver is fs", () => {
    const warnings: string[] = [];
    const prev = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const uploads = files("uploads");
      bindStore(
        {
          stores: [uploads],
          config: {
            drivers: {
              store: {
                files: { dev: "s3", test: "fs", prod: "s3" },
              },
            },
          },
        },
        "test",
        () => Date.now(),
        false,
      );
      bindStore(
        {
          stores: [uploads],
          config: {
            drivers: {
              store: {
                files: { dev: "s3", test: "fs", prod: "s3" },
              },
            },
          },
        },
        "test",
        () => Date.now(),
        false,
      );
      expect(warnings.some((w) => w.includes('drivers.store.files "fs"'))).toBe(true);
      expect(warnings.filter((w) => w.includes('drivers.store.files "fs"'))).toHaveLength(1);
    } finally {
      console.warn = prev;
    }
  });

  test("does not warn for memory or s3 files", () => {
    const warnings: string[] = [];
    const prev = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      bindStore(
        {
          stores: [files("uploads")],
          config: {
            drivers: {
              store: {
                files: { dev: "s3", test: "memory", prod: "s3" },
              },
            },
          },
        },
        "test",
        () => Date.now(),
        false,
      );
      expect(warnings.some((w) => w.includes('drivers.store.files "fs"'))).toBe(false);
    } finally {
      console.warn = prev;
    }
  });
});

describe("bindStore index driver resolution", () => {
  const prevIndex = process.env.OKE_INDEX_DRIVER;

  afterEach(() => {
    if (prevIndex === undefined) delete process.env.OKE_INDEX_DRIVER;
    else process.env.OKE_INDEX_DRIVER = prevIndex;
  });

  test("defaults to memory when no index driver is configured", () => {
    expect(resolveIndexDriverId({}, "test", false)).toBe("memory");
    expect(resolveIndexDriverId({}, "dev", true)).toBe("memory");
    expect(indexDriverFor("memory").id).toBe("memory");
  });

  test("config drivers.store.index is honoured per env", () => {
    const options = {
      config: {
        drivers: {
          store: {
            index: { dev: "pgvector", test: "memory", prod: "pgvector" },
          },
        },
      },
    };
    expect(resolveIndexDriverId(options, "test", false)).toBe("memory");
    expect(resolveIndexDriverId(options, "dev", true)).toBe("pgvector");
    expect(resolveIndexDriverId(options, "prod", false)).toBe("pgvector");
  });

  test("pgvector resolves from config", () => {
    const options = {
      config: { drivers: { store: { index: { test: "pgvector" } } } },
    };
    expect(resolveIndexDriverId(options, "test", false)).toBe("pgvector");
    expect(indexDriverFor("pgvector").id).toBe("pgvector");
  });

  test("meilisearch resolves from config as a fourth id", () => {
    const options = {
      config: { drivers: { store: { index: { dev: "meilisearch", test: "meilisearch" } } } },
    };
    expect(resolveIndexDriverId(options, "test", false)).toBe("meilisearch");
    expect(resolveIndexDriverId(options, "dev", true)).toBe("meilisearch");
    expect(indexDriverFor("meilisearch").id).toBe("meilisearch");
  });

  test("docker mode honours OKE_INDEX_DRIVER override", () => {
    process.env.OKE_INDEX_DRIVER = "pgvector";
    expect(resolveIndexDriverId({}, "dev", true)).toBe("pgvector");
    expect(resolveIndexDriverId({}, "test", false)).toBe("memory");
  });

  test("indexDriverFor returns the configured driver and throws on unknown ids", () => {
    expect(indexDriverFor("pgvector").id).toBe("pgvector");
    expect(() => indexDriverFor("chroma")).toThrow(/unknown index driver "chroma"/);
  });
});
