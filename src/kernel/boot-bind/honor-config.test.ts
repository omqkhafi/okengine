/**
 * Boot-level acceptance: binders honour `drivers.*` config pins.
 *
 * Asserts runtime identity (driverId / store kind / chain), not hero strings.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRedisFakeClient } from "../../drivers/redis.ts";
import { createSignalRedisFake } from "../../drivers/signal-redis.ts";
import { clock } from "../../elements/clock.ts";
import { gate } from "../../elements/gate.ts";
import { signal } from "../../elements/signal.ts";
import { vault } from "../../elements/vault.ts";
import { buildVaultBootChain } from "../../elements/vault/boot-chain.ts";
import { flow } from "../flow.ts";
import { bootApplication } from "../boot.ts";

describe("boot binders honour drivers.* config", () => {
  const prevCwd = process.cwd();
  let tmp: string | undefined;

  afterEach(async () => {
    process.chdir(prevCwd);
    if (tmp) {
      await rm(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
    delete process.env.OKE_VAULT_URL;
    delete process.env.OKE_VAULT_TOKEN;
    delete process.env.REDIS_URL;
  });

  test("vault: drivers.vault env builds env chain layers", async () => {
    process.env.APP_NAME = "honor-config";
    try {
      const result = await bootApplication({
        env: "test",
        secrets: [vault.config("APP_NAME", { description: "app" })],
        config: {
          drivers: {
            vault: { test: "env" },
          },
        },
      });
      try {
        expect(result.vault).toBeDefined();
        expect(result.vault!.chainDriverIds).toContain("env");
        expect(result.vault!.chainDriverIds).toContain("memory");
        expect(result.vault!.chainDriverIds[0]).toBe("memory");
      } finally {
        await result.close();
      }
    } finally {
      delete process.env.APP_NAME;
    }
  });

  test("vault: drivers.vault vault selects built-in layer in front of env", () => {
    const chain = buildVaultBootChain({
      driverId: "vault",
      env: "test",
    });
    expect(chain[0]?.driver.id).toBe("vault");
    expect(chain.map((l) => l.driver.id)).toContain("env");
  });

  test("vault: unknown driver id fails loud at boot", async () => {
    const removed = ["open", "bao"].join("");
    await expect(
      bootApplication({
        env: "prod",
        secrets: [vault.config("APP_NAME", { description: "app", dev: "x" })],
        vault: { allowDevFallbacks: true },
        config: {
          drivers: {
            vault: { prod: removed },
          },
        },
      }),
    ).rejects.toThrow(/unknown vault driver/);
  });

  test("clock: drivers.clock memory binds memory CronStore", async () => {
    // `test` env always forces frozen — pin under `dev` to honour memory.
    const result = await bootApplication({
      env: "dev",
      startScheduler: false,
      clocks: [clock("tick", { every: "1h" })],
      config: {
        drivers: {
          clock: { dev: "memory" },
          store: { sql: { dev: "memory" }, kv: { dev: "memory" } },
        },
      },
    });
    try {
      expect(result.clock!.driverId).toBe("memory");
      expect(result.clock!.store.kind).toBe("memory");
    } finally {
      await result.close();
    }
  });

  test("clock: drivers.clock file binds file CronStore", async () => {
    tmp = await mkdtemp(join(tmpdir(), "oke-clock-file-"));
    process.chdir(tmp);
    const result = await bootApplication({
      env: "dev",
      startScheduler: false,
      clocks: [clock("tick", { every: "1h" })],
      config: {
        drivers: {
          clock: { dev: "file" },
          store: { sql: { dev: "memory" }, kv: { dev: "memory" } },
        },
      },
    });
    try {
      expect(result.clock!.driverId).toBe("file");
      expect(result.clock!.store.kind).toBe("file");
    } finally {
      await result.close();
    }
  });

  test("clock: drivers.clock postgres fails without DATABASE_URL", async () => {
    const prevDb = process.env.DATABASE_URL;
    const prevStore = process.env.OKE_STORE_SQL_URL;
    delete process.env.DATABASE_URL;
    delete process.env.OKE_STORE_SQL_URL;
    try {
      await expect(
        bootApplication({
          env: "dev",
          startScheduler: false,
          clocks: [clock("tick", { every: "1h" })],
          config: {
            drivers: {
              clock: { dev: "postgres" },
              store: { sql: { dev: "memory" }, kv: { dev: "memory" } },
            },
          },
        }),
      ).rejects.toThrow(/clock driver "postgres" needs DATABASE_URL/);
    } finally {
      if (prevDb !== undefined) process.env.DATABASE_URL = prevDb;
      else delete process.env.DATABASE_URL;
      if (prevStore !== undefined) process.env.OKE_STORE_SQL_URL = prevStore;
      else delete process.env.OKE_STORE_SQL_URL;
    }
  });

  test("journal: durable flow binds memory journal by default", async () => {
    const result = await bootApplication({
      env: "test",
      startScheduler: false,
      flows: [flow("charge", { durable: true, do: () => ({ ok: true }) })],
    });
    try {
      expect(result.journal?.driverId).toBe("memory");
      expect(typeof result.journal?.instanceId).toBe("string");
      expect(result.journal?.leaseMs).toBeGreaterThan(0);
    } finally {
      await result.close();
    }
  });

  test("journal: no durable flow → no journal runtime", async () => {
    const result = await bootApplication({
      env: "test",
      startScheduler: false,
      flows: [flow("plain", { do: () => ({ ok: true }) })],
    });
    try {
      expect(result.journal).toBeUndefined();
    } finally {
      await result.close();
    }
  });

  test("journal: drivers.journal file binds file store", async () => {
    tmp = await mkdtemp(join(tmpdir(), "oke-journal-file-"));
    process.chdir(tmp);
    const result = await bootApplication({
      env: "test",
      startScheduler: false,
      flows: [flow("charge", { durable: true, do: () => ({ ok: true }) })],
      config: {
        drivers: {
          journal: { test: "file" },
        },
      },
    });
    try {
      expect(result.journal?.driverId).toBe("file");
    } finally {
      await result.close();
    }
  });

  test("journal: drivers.journal postgres fails without DATABASE_URL", async () => {
    const prevDb = process.env.DATABASE_URL;
    const prevStore = process.env.OKE_STORE_SQL_URL;
    delete process.env.DATABASE_URL;
    delete process.env.OKE_STORE_SQL_URL;
    try {
      await expect(
        bootApplication({
          env: "test",
          startScheduler: false,
          flows: [flow("charge", { durable: true, do: () => ({ ok: true }) })],
          config: {
            drivers: {
              journal: { test: "postgres" },
            },
          },
        }),
      ).rejects.toThrow(/journal driver "postgres" needs DATABASE_URL/);
    } finally {
      if (prevDb !== undefined) process.env.DATABASE_URL = prevDb;
      else delete process.env.DATABASE_URL;
      if (prevStore !== undefined) process.env.OKE_STORE_SQL_URL = prevStore;
      else delete process.env.OKE_STORE_SQL_URL;
    }
  });

  test("journal: unknown driver fails loud", async () => {
    await expect(
      bootApplication({
        env: "test",
        startScheduler: false,
        flows: [flow("charge", { durable: true, do: () => ({ ok: true }) })],
        config: {
          drivers: {
            journal: { test: "neon" },
          },
        },
      }),
    ).rejects.toThrow(/unknown journal driver "neon"/);
  });

  test("gate: drivers.store.kv redis opens redis-backed oke:gates", async () => {
    const fake = createRedisFakeClient();
    const result = await bootApplication({
      env: "test",
      gates: [gate.rate({ max: 10, per: "1m" })],
      clients: { kv: fake },
      config: {
        drivers: {
          store: {
            kv: { test: "redis", dev: "redis", prod: "redis" },
          },
        },
      },
    });
    try {
      expect(result.gate!.kvDriverId).toBe("redis");
    } finally {
      await result.close();
    }
  });

  test("gate: drivers.store.kv redis without REDIS_URL fails loud (never soft memory)", async () => {
    delete process.env.REDIS_URL;
    delete process.env.OKE_STORE_KV_URL;
    await expect(
      bootApplication({
        env: "test",
        gates: [gate.rate({ max: 10, per: "1m" })],
        config: {
          drivers: {
            store: {
              kv: { test: "redis", dev: "redis", prod: "redis" },
            },
          },
        },
      }),
    ).rejects.toThrow(/gate redis kv needs REDIS_URL/);
  });

  test("gate: drivers.store.kv memory keeps memory oke:gates", async () => {
    const result = await bootApplication({
      env: "test",
      gates: [gate.rate({ max: 10, per: "1m" })],
      config: {
        drivers: {
          store: {
            kv: { dev: "redis", test: "memory", prod: "redis" },
          },
        },
      },
    });
    try {
      expect(result.gate!.kvDriverId).toBe("memory");
    } finally {
      await result.close();
    }
  });

  test("signal: drivers.signal memory binds memory", async () => {
    const result = await bootApplication({
      env: "test",
      signals: [signal.once("ping")],
      config: {
        drivers: {
          signal: { dev: "redis", test: "memory", prod: "redis" },
        },
      },
    });
    try {
      expect(result.signal!.driverId).toBe("memory");
    } finally {
      await result.close();
    }
  });

  test("signal: drivers.signal redis binds redis", async () => {
    const fake = createSignalRedisFake();
    const result = await bootApplication({
      env: "test",
      signals: [signal.once("ping")],
      clients: { signalRedis: fake },
      config: {
        drivers: {
          signal: { test: "redis", dev: "redis", prod: "redis" },
        },
      },
    });
    try {
      expect(result.signal!.driverId).toBe("redis");
    } finally {
      await result.close();
    }
  });

  test("signal: drivers.signal postgres fails loud (never silent memory)", async () => {
    await expect(
      bootApplication({
        env: "test",
        signals: [signal.once("ping")],
        config: {
          drivers: {
            signal: { test: "postgres" },
          },
        },
      }),
    ).rejects.toThrow(/signal driver "postgres"/);
  });

  test("runs: drivers.runs unset in test binds memory", async () => {
    const result = await bootApplication({
      env: "test",
      runs: {},
    });
    try {
      expect(result.runs?.store?.driverId).toBe("memory");
    } finally {
      await result.close();
    }
  });

  test("runs: drivers.runs unset in dev writes .oke/runs", async () => {
    tmp = await mkdtemp(join(tmpdir(), "oke-runs-dev-"));
    const result = await bootApplication({
      env: "dev",
      rootDir: tmp,
      runs: {},
      config: {},
    });
    try {
      expect(result.runs?.store?.driverId).toBe("files");
      const startedAt = Date.now();
      await result.runs!.append({
        id: "boot-persist",
        flow: "ping",
        trigger: "internal",
        plane: "user",
        gates: [],
        cache: "none",
        effects: [],
        logs: [],
        error: null,
        durationMs: 1,
        startedAt,
        endedAt: startedAt + 1,
        dimensions: { flow: "ping" },
      });
      await result.runs!.flush();
      const parquet = new Bun.Glob("**/*.parquet");
      const keys: string[] = [];
      for await (const match of parquet.scan({ cwd: join(tmp, ".oke/runs"), onlyFiles: true })) {
        keys.push(match);
      }
      expect(keys.length).toBeGreaterThan(0);
    } finally {
      await result.close();
    }
  });

  test("runs: drivers.runs memory pin wins over RUNS_DEFAULTS in dev", async () => {
    const result = await bootApplication({
      env: "dev",
      runs: {},
      config: {
        drivers: {
          runs: { dev: "memory" },
        },
      },
    });
    try {
      expect(result.runs?.store?.driverId).toBe("memory");
    } finally {
      await result.close();
    }
  });

  test("signal: drivers.signal nats fails loud", async () => {
    await expect(
      bootApplication({
        env: "test",
        signals: [signal.once("ping")],
        config: {
          drivers: {
            signal: { test: "nats" },
          },
        },
      }),
    ).rejects.toThrow(/signal driver "nats"/);
  });
});
