/**
 * Boot sequence acceptance:
 * - missing secrets fail naming every gap at once
 * - capability tokens minted from flow effects (Manifest)
 * - declared cron fires on a running app without manual dispatch
 * - real timer loop starts by default outside test env (fake wall-clock)
 */

import { afterEach, describe, expect, jest, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryVaultDriver } from "../drivers/index.ts";
import { clock } from "../elements/clock.ts";
import { store } from "../elements/store.ts";
import { vault, VaultBootError } from "../elements/vault.ts";
import { bootApplication, resolveElementNeeds } from "./boot.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { every, http } from "./triggers.ts";
import { oke } from "./app.ts";
import { on, resetBindings } from "./on.ts";

describe("boot — vault gaps", () => {
  test("two missing secrets fail naming both at once", async () => {
    try {
      await bootApplication({
        env: "prod",
        secrets: [
          vault("STRIPE_KEY", { description: "Payments gateway key" }),
          vault("DATABASE_URL", { description: "Primary SQL URL" }),
        ],
        vault: {
          allowDevFallbacks: false,
          chain: [{ driver: memoryVaultDriver, options: { secrets: {} } }],
        },
      });
      expect.unreachable("boot should fail");
    } catch (err) {
      expect(err).toBeInstanceOf(VaultBootError);
      const boot = err as VaultBootError;
      expect(boot.gaps.map((g) => g.name).sort()).toEqual(["DATABASE_URL", "STRIPE_KEY"]);
      expect(boot.message).toContain("STRIPE_KEY");
      expect(boot.message).toContain("DATABASE_URL");
    }
  });

  test("three missing secrets still list every gap at once", async () => {
    try {
      await bootApplication({
        env: "prod",
        secrets: [
          vault("A", { description: "one" }),
          vault("B", { description: "two" }),
          vault("C", { description: "three" }),
        ],
        vault: {
          allowDevFallbacks: false,
          chain: [{ driver: memoryVaultDriver, options: { secrets: {} } }],
        },
      });
      expect.unreachable("boot should fail");
    } catch (err) {
      expect(err).toBeInstanceOf(VaultBootError);
      const boot = err as VaultBootError;
      expect(boot.gaps.map((g) => g.name).sort()).toEqual(["A", "B", "C"]);
    }
  });
});

describe("boot — lazy element needs", () => {
  test("Store-only declarations do not require AI/channel/vault", () => {
    const needs = resolveElementNeeds({
      stores: [store.sql("notes", { schema: {} as never })],
    });
    expect(needs.store).toBe(true);
    expect(needs.ai).toBe(false);
    expect(needs.channel).toBe(false);
    expect(needs.vault).toBe(false);
    expect(needs.signal).toBe(false);
  });

  test("oke() Store-only graph stays under the prior 48 kB baseline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-store-only-"));
    const entry = join(dir, "entry.ts");
    const appPath = join(import.meta.dir, "app.ts");
    const storePath = join(import.meta.dir, "../elements/store.ts");
    await Bun.write(
      entry,
      `import { oke } from ${JSON.stringify(appPath)};\n` +
        `import { store } from ${JSON.stringify(storePath)};\n` +
        `export const app = oke({ name: "notes" });\n` +
        `export { store };\n`,
    );
    try {
      const result = await Bun.build({
        entrypoints: [entry],
        minify: true,
        target: "bun",
        format: "esm",
        external: [
          "@duckdb/node-api",
          "@duckdb/*",
          "sently",
          "sently/*",
          "ajv",
          "ajv/*",
          "ajv-formats",
          "oxc-parser",
          "zod",
        ],
      });
      expect(result.success).toBe(true);
      let total = 0;
      for (const o of result.outputs) {
        const raw = await o.arrayBuffer();
        if (raw.byteLength === 0) continue;
        total += Bun.gzipSync(new Uint8Array(raw)).byteLength;
      }
      // Rebased after 0.12.0 store/http graph growth
      // (~47.6 kB gzip with export externals).
      expect(total).toBeLessThan(48_000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("boot — capabilities from Manifest effects", () => {
  test("tokens cover declared effects only", async () => {
    const charge = flow("payments.charge", {
      effects: { secrets: ["STRIPE_KEY"], writes: ["sql:orders"] },
      do: () => ({ ok: true }),
    });
    const result = await bootApplication({
      env: "test",
      secrets: [vault("STRIPE_KEY", { dev: "sk_test" })],
      vault: { allowDevFallbacks: true, chain: [] },
      flows: [charge],
    });
    const cap = result.capabilities.get("payments.charge");
    expect(cap).toBeDefined();
    expect(cap!.allows("secret", "STRIPE_KEY")).toBe(true);
    expect(cap!.allows("write", "sql:orders")).toBe(true);
    expect(cap!.allows("secret", "OTHER")).toBe(false);
    await result.close();
  });
});

describe("boot — cron fires without manual dispatch", () => {
  test("scheduler tick runs a due every-binding", async () => {
    resetBindings();
    resetFlowSeq();

    let ran = 0;
    on(
      every("1h"),
      flow("cleanup.expire", {
        do: () => {
          ran += 1;
        },
      }),
    );

    const app = oke({
      name: "cron-boot",
      clocks: [clock("expire-stale", { every: "1h" })],
      env: "test",
    });

    await app.boot({
      env: "test",
      startScheduler: false,
      clocks: [clock("expire-stale", { every: "1h" })],
    });

    const rt = app.bootResult!.clock!;
    expect((await rt.store.list()).map((r) => r.name)).toEqual(["expire-stale"]);
    // First tick — due (never ran). Named clock covers `every("1h")` — no twin `1h` row.
    const { ran: names } = await rt.tick();
    expect(names).toEqual(["expire-stale"]);
    expect(ran).toBe(1);

    // Advance past the effective every; tick again without dispatchEvery.
    rt.advance("1h");
    const before = ran;
    await rt.tick();
    expect(ran).toBeGreaterThan(before);

    await app.bootResult?.close();
  });
});

describe("boot — HTTP gate wiring on the default path", () => {
  test("autoBoot: false still serves without gates (explicit escape hatch)", async () => {
    resetBindings();
    resetFlowSeq();
    on(
      http.get("/ping"),
      flow("ping", {
        do: () => ({ ok: true }),
      }),
    );
    const app = oke({ name: "legacy", autoBoot: false });
    const res = await app.fetch(new Request("http://localhost/ping", { method: "GET" }));
    expect(res.status).toBe(200);
    expect(app.booted).toBe(false);
  });

  test("bare oke().fetch() enforces gate posture by default (no flags)", async () => {
    resetBindings();
    resetFlowSeq();
    const { GateBootError } = await import("../elements/gate/boot.ts");
    on(
      http.get("/ping"),
      flow("ping", {
        do: () => ({ ok: true }),
      }),
    );
    const app = oke({ name: "default-posture" });
    await expect(
      app.fetch(new Request("http://localhost/ping", { method: "GET" })),
    ).rejects.toThrow(GateBootError);
    expect(app.booted).toBe(false);
  });

  test("bare oke().fetch() with gate.public boots and serves", async () => {
    resetBindings();
    resetFlowSeq();
    on(
      http.get("/ping").gate.public,
      flow("ping-public", {
        do: () => ({ ok: true }),
      }),
    );
    const app = oke({ name: "default-public", env: "test", startScheduler: false });
    const res = await app.fetch(new Request("http://localhost/ping", { method: "GET" }));
    expect(res.status).toBe(200);
    expect(app.booted).toBe(true);
    await app.stop();
  });
});

describe("boot — cron autostart via real timer loop", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("booted app (non-test) fires every() with no manual tick/runNow", async () => {
    resetBindings();
    resetFlowSeq();
    jest.useFakeTimers({ now: 1_000_000 });

    let ran = 0;
    on(
      every("10m"),
      flow("cleanup.autostart", {
        do: () => {
          ran += 1;
        },
      }),
    );

    // Non-test env → startScheduler defaults ON. No createTestApp / advance.
    const app = oke({
      name: "cron-autostart",
      env: "dev",
      schedulerIntervalMs: 1000,
      config: {
        drivers: {
          clock: { dev: "memory" },
          store: { sql: { dev: "memory" }, kv: { dev: "memory" } },
          channel: { email: { dev: "console" } },
        },
      },
    });
    await app.boot();

    expect(ran).toBe(0);

    // Drive the wall-clock interval that boot installed — not clock.advance /
    // runNow / dispatchEvery (those prove the harness, not autostart).
    jest.advanceTimersByTime(1000);
    // Interval callback does `void clock.tick()`; drain the async store walk.
    for (let i = 0; i < 50; i++) await Promise.resolve();

    expect(ran).toBeGreaterThanOrEqual(1);

    await app.stop();
  });
});
