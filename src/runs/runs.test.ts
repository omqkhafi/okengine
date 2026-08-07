/**
 * Runs store acceptance:
 * - a run carries all declared dimensions with zero instrumentation
 * - outlier explanation correctly identifies the separating dimension on a seeded dataset
 * - a query spanning local and object-storage partitions returns one result set
 * - erasure renders a subject's archived fields unreadable without rewriting partitions
 * - fx.log lines are a field on the run, not a stream
 * - optional postgres / clickhouse drivers append + query
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fsDriver, memoryFilesDriver } from "../drivers/index.ts";
import { gate } from "../elements/gate.ts";
import { oke } from "../kernel/app.ts";
import { flow } from "../kernel/flow.ts";
import { on, resetBindings } from "../kernel/on.ts";
import { http } from "../kernel/triggers.ts";
import {
  SHREDDED,
  archiveFields,
  createMemorySubjectKeys,
  createRunsRuntime,
  explainOutliers,
  privacyErase,
  revealArchived,
  seedOutlierDataset,
  subjectKeyName,
} from "./index.ts";

const temps: string[] = [];

afterEach(async () => {
  resetBindings();
  for (const t of temps.splice(0)) {
    await rm(t, { recursive: true, force: true }).catch(() => undefined);
  }
});

async function tmpDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "oke-runs-test-"));
  temps.push(d);
  return d;
}

describe("zero-instrumentation dimensions", () => {
  test("a run carries declared dimensions without flow instrumentation", async () => {
    resetBindings();
    const runs = createRunsRuntime({
      driver: "memory",
      buildVersion: "1.2.3",
    });
    await runs.open();

    const member = gate.policy("member", ({ auth }) => !!auth.verified);

    on(
      http.get("/book").gate(member),
      flow("bookings.create", {
        plane: "user",
        effects: { reads: ["sql:bookings"] },
        do: async (_input, fx) => {
          fx.log.info("booking started", { step: 1 });
          await fx.cache.set("k", "v");
          const hit = await fx.cache.get("k");
          expect(hit).toBe("v");
          return { ok: true };
        },
      }),
    );

    const app = oke({
      name: "runs-dims",
      runs,
      gate: { policies: [member] },
      fx: {
        auth: { userId: "user_42", scopes: new Set(["book:write"]), verified: true },
        tenant: { id: "org_a41" },
      },
    });

    const matched = app.router.match("GET", "/book");
    expect(matched).toBeTruthy();
    await app.execute(matched!.value.flow, {}, matched!.value.trigger);

    await runs.flush();
    const events = await runs.all();
    expect(events.length).toBe(1);
    const e = events[0]!;
    expect(e.flow).toBe("bookings.create");
    expect(e.unit).toBe("bookings");
    expect(e.trigger).toBe("http");
    expect(e.plane).toBe("user");
    expect(e.tenant).toBe("org_a41");
    expect(e.principal).toBe("user_42");
    expect(e.gates).toContain("member");
    expect(e.cache).toBe("hit");
    expect(e.buildVersion).toBe("1.2.3");
    expect(e.logs.length).toBe(1);
    expect(e.logs[0]!.message).toBe("booking started");
    expect(e.dimensions.flow).toBe("bookings.create");
    expect(e.dimensions.tenant).toBe("org_a41");
    expect(e.dimensions.cache).toBe("hit");

    await runs.close();
  });
});

describe("outlier explanation", () => {
  test("identifies the separating dimension on a seeded dataset", () => {
    const events = seedOutlierDataset({
      n: 1000,
      slowShare: 0.1,
      separatingDimension: "cache",
      separatingValue: "miss",
      slowDurationMs: 2000,
      fastDurationMs: 40,
    });
    const findings = explainOutliers(events, {
      select: (e) => e.durationMs >= 1000,
      minLift: 0.2,
    });
    expect(findings.length).toBeGreaterThan(0);
    const top = findings[0]!;
    expect(top.dimension).toBe("cache");
    expect(top.value).toBe("miss");
    expect(top.lift).toBeGreaterThan(0.5);
    expect(top.explanation).toMatch(/cache=miss/);
  });
});

describe("locality — local + object storage", () => {
  test("query spanning local and remote partitions returns one result set", async () => {
    const root = await tmpDir();
    const remoteBucket = await memoryFilesDriver.open({ name: "runs-remote" });
    // hot window 1 hour — events older than that go remote
    const hotWindowMs = 60 * 60 * 1000;
    const runs = createRunsRuntime({
      driver: "files",
      localRoot: root,
      remote: { bucket: remoteBucket },
      hotWindowMs,
    });
    await runs.open();

    const now = Date.now();
    const base = {
      flow: "ping",
      trigger: "http" as const,
      plane: "user" as const,
      gates: [] as string[],
      cache: "none" as const,
      effects: [],
      logs: [],
      error: null,
      principal: "u1",
      tenant: "t1",
      subjectId: "u1",
    };

    await runs.append({
      ...base,
      id: "recent",
      durationMs: 10,
      startedAt: now - 1000,
      endedAt: now,
      dimensions: { flow: "ping", locality: "local", duration_ms: 10 },
    });
    await runs.append({
      ...base,
      id: "archived",
      durationMs: 20,
      startedAt: now - hotWindowMs * 2,
      endedAt: now - hotWindowMs * 2 + 20,
      dimensions: { flow: "ping", locality: "remote", duration_ms: 20 },
    });
    await runs.flush();

    // Prove bytes landed in both buckets
    const localBucket = await fsDriver.open({ name: "check", root: root });
    const localKeys = await localBucket.list("runs/");
    const remoteKeys = await remoteBucket.list("runs/");
    expect(localKeys.some((k) => k.endsWith(".parquet"))).toBe(true);
    expect(remoteKeys.some((k) => k.endsWith(".parquet"))).toBe(true);

    const rows = await runs.query("SELECT id, dim_locality AS locality FROM runs ORDER BY id");
    expect(rows.length).toBe(2);
    const ids = rows.map((r) => String(r.id)).sort();
    expect(ids).toEqual(["archived", "recent"]);

    await runs.close();
    await localBucket.close();
    await remoteBucket.close();
  });
});

describe("crypto-shredding erasure", () => {
  test("erasure renders archived fields unreadable without rewriting partitions", async () => {
    const root = await tmpDir();
    const keys = createMemorySubjectKeys();
    const runs = createRunsRuntime({
      driver: "files",
      localRoot: root,
      subjectKeys: keys,
    });
    await runs.open();

    const subjectId = "user_erase_1";
    const archived = await archiveFields(keys, subjectId, {
      email: "alice@example.com",
      phone: "+966500000000",
    });
    expect(keys.has(subjectKeyName(subjectId))).toBe(true);

    const beforeReveal = await revealArchived(keys, subjectId, archived);
    expect(beforeReveal.email).toBe("alice@example.com");

    const startedAt = Date.now();
    await runs.append({
      id: "run_erase",
      flow: "profile.update",
      trigger: "http",
      plane: "user",
      tenant: "org_1",
      principal: subjectId,
      subjectId,
      gates: [],
      cache: "none",
      effects: [],
      logs: [],
      durationMs: 5,
      startedAt,
      endedAt: startedAt + 5,
      archived,
      dimensions: { flow: "profile.update", subject_id: subjectId },
      error: null,
    });
    await runs.flush();

    // Snapshot partition bytes before erase
    const bucket = await fsDriver.open({ name: "snap", root: root });
    const keysBefore = (await bucket.list("runs/")).filter((k) => k.endsWith(".parquet"));
    expect(keysBefore.length).toBeGreaterThan(0);
    const bytesBefore = await bucket.get(keysBefore[0]!);
    expect(bytesBefore).toBeTruthy();

    const result = privacyErase({ subjectId, subjectKeys: keys, write: () => {} });
    expect(result.deleted).toBe(true);
    expect(keys.has(subjectKeyName(subjectId))).toBe(false);

    const after = await revealArchived(keys, subjectId, archived);
    expect(after.email).toBe(SHREDDED);
    expect(after.phone).toBe(SHREDDED);

    // Partitions unchanged
    const bytesAfter = await bucket.get(keysBefore[0]!);
    expect(bytesAfter).toEqual(bytesBefore);

    // Query still returns the row (operational dims intact)
    const rows = await runs.query("SELECT id, subject_id FROM runs WHERE id = 'run_erase'");
    expect(rows.length).toBe(1);
    expect(rows[0]!.subject_id).toBe(subjectId);

    await runs.close();
    await bucket.close();
  });
});

describe("optional drivers", () => {
  test("postgres driver appends and queries", async () => {
    const runs = createRunsRuntime({ driver: "postgres" });
    await runs.open();
    const t = Date.now();
    await runs.append({
      id: "pg1",
      flow: "x",
      trigger: "internal",
      plane: "user",
      gates: [],
      cache: "none",
      effects: [],
      logs: [],
      durationMs: 1,
      startedAt: t,
      endedAt: t + 1,
      dimensions: { flow: "x" },
      error: null,
    });
    const rows = await runs.query("SELECT count(*) AS count FROM oke_runs");
    expect(Number(rows[0]!.count)).toBe(1);
    await runs.close();
  });

  test("clickhouse driver appends and queries", async () => {
    const runs = createRunsRuntime({ driver: "clickhouse" });
    await runs.open();
    const t = Date.now();
    await runs.append({
      id: "ch1",
      flow: "y",
      trigger: "internal",
      plane: "user",
      gates: [],
      cache: "none",
      effects: [],
      logs: [],
      durationMs: 2,
      startedAt: t,
      endedAt: t + 2,
      dimensions: { flow: "y" },
      error: null,
    });
    const rows = await runs.query("SELECT count() AS count FROM oke_runs");
    expect(Number(rows[0]!.count)).toBe(1);
    await runs.close();
  });
});
