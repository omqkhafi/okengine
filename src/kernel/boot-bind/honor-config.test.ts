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
        env: "local",
        secrets: [vault.config("APP_NAME", { description: "app" })],
        config: {
          drivers: {
            vault: { local: "env", docker: "openbao", test: "memory", prod: "openbao" },
          },
        },
      });
      try {
        expect(result.vault).toBeDefined();
        expect(result.vault!.chainDriverIds).toContain("env");
        expect(result.vault!.chainDriverIds).toContain("memory");
        expect(result.vault!.chainDriverIds[0]).toBe("env");
      } finally {
        await result.close();
      }
    } finally {
      delete process.env.APP_NAME;
    }
  });

  test("vault: drivers.vault openbao with credentials selects openbao layer", () => {
    process.env.OKE_VAULT_URL = "http://127.0.0.1:8200";
    process.env.OKE_VAULT_TOKEN = "test-token";
    const chain = buildVaultBootChain({
      driverId: "openbao",
      env: "local",
      missingOpenbao: "throw",
    });
    expect(chain.map((l) => l.driver.id)).toContain("openbao");
    expect(chain.map((l) => l.driver.id)).toContain("env");
  });

  test("vault: openbao without credentials fails loud in prod", async () => {
    delete process.env.OKE_VAULT_URL;
    delete process.env.OKE_VAULT_TOKEN;
    await expect(
      bootApplication({
        env: "prod",
        secrets: [vault.config("APP_NAME", { description: "app", dev: "x" })],
        vault: { allowDevFallbacks: true },
        config: {
          drivers: {
            vault: { prod: "openbao" },
          },
        },
      }),
    ).rejects.toThrow(/openbao.*OKE_VAULT_URL/);
  });

  test("clock: drivers.clock memory binds memory CronStore", async () => {
    const result = await bootApplication({
      env: "local",
      startScheduler: false,
      clocks: [clock("tick", { every: "1h" })],
      config: {
        drivers: {
          clock: { local: "memory", docker: "file", test: "frozen", prod: "file" },
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
      env: "local",
      startScheduler: false,
      clocks: [clock("tick", { every: "1h" })],
      config: {
        drivers: {
          clock: { local: "file", docker: "file", test: "frozen", prod: "file" },
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
          env: "local",
          startScheduler: false,
          clocks: [clock("tick", { every: "1h" })],
          config: {
            drivers: {
              clock: { local: "postgres" },
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
      env: "local",
      startScheduler: false,
      flows: [flow({ name: "charge", durable: true, do: () => ({ ok: true }) })],
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
      env: "local",
      startScheduler: false,
      flows: [flow({ name: "plain", do: () => ({ ok: true }) })],
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
      env: "local",
      startScheduler: false,
      flows: [flow({ name: "charge", durable: true, do: () => ({ ok: true }) })],
      config: {
        drivers: {
          journal: { local: "file", docker: "postgres", test: "memory", prod: "postgres" },
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
          env: "local",
          startScheduler: false,
          flows: [flow({ name: "charge", durable: true, do: () => ({ ok: true }) })],
          config: {
            drivers: {
              journal: { local: "postgres" },
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
        env: "local",
        startScheduler: false,
        flows: [flow({ name: "charge", durable: true, do: () => ({ ok: true }) })],
        config: {
          drivers: {
            journal: { local: "neon" },
          },
        },
      }),
    ).rejects.toThrow(/unknown journal driver "neon"/);
  });

  test("gate: drivers.store.kv redis opens redis-backed oke:gates", async () => {
    const fake = createRedisFakeClient();
    const result = await bootApplication({
      env: "local",
      gates: [gate.rate({ max: 10, per: "1m" })],
      clients: { kv: fake },
      config: {
        drivers: {
          store: {
            kv: { local: "redis", docker: "redis", prod: "redis" },
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
        env: "local",
        gates: [gate.rate({ max: 10, per: "1m" })],
        config: {
          drivers: {
            store: {
              kv: { local: "redis", docker: "redis", prod: "redis" },
            },
          },
        },
      }),
    ).rejects.toThrow(/gate redis kv needs REDIS_URL/);
  });

  test("gate: drivers.store.kv memory keeps memory oke:gates", async () => {
    const result = await bootApplication({
      env: "local",
      gates: [gate.rate({ max: 10, per: "1m" })],
      config: {
        drivers: {
          store: {
            kv: { local: "memory", docker: "redis", prod: "redis" },
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
      env: "local",
      signals: [signal("ping", { delivery: "once" })],
      config: {
        drivers: {
          signal: { local: "memory", docker: "redis", prod: "redis" },
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
      env: "local",
      signals: [signal("ping", { delivery: "once" })],
      clients: { signalRedis: fake },
      config: {
        drivers: {
          signal: { local: "redis", docker: "redis", prod: "redis" },
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
        env: "local",
        signals: [signal("ping", { delivery: "once" })],
        config: {
          drivers: {
            signal: { local: "postgres" },
          },
        },
      }),
    ).rejects.toThrow(/signal driver "postgres"/);
  });

  test("signal: drivers.signal nats fails loud", async () => {
    await expect(
      bootApplication({
        env: "local",
        signals: [signal("ping", { delivery: "once" })],
        config: {
          drivers: {
            signal: { local: "nats" },
          },
        },
      }),
    ).rejects.toThrow(/signal driver "nats"/);
  });
});
