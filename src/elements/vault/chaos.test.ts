/**
 * Vault-builtin adversarial proofs — real OS processes, real SIGKILL,
 * real concurrent access (same discipline as Signal/Clock/Journal chaos).
 *
 * Live multi-process Postgres cases: set `OKE_TEST_POSTGRES_URL` (or
 * `OKE_TEST_POSTGRES=1` + `DATABASE_URL`). Without a live Postgres those
 * describes skip visibly. On-disk PGlite covers sequential crash/resume
 * and single-writer proofs that do not need two concurrent DB clients.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { connectPglite } from "../../drivers/pglite.ts";
import { connectPostgres } from "../../drivers/postgres.ts";
import type { SqlConnection } from "../../drivers/types.ts";
import {
  BACKUP_END_MARKER,
  BACKUP_MAGIC,
  createBuiltinVaultAdapter,
  sqlConnectionAsExec,
  writeBackupFileAtomic,
} from "./builtin-adapter.ts";
import { generateMasterKey } from "./crypto.ts";
import { isVaultError } from "./errors.ts";
import { resetVaultTables } from "./test-helpers.ts";

const childPath = join(import.meta.dir, "chaos-child.ts");

const LIVE_URL =
  process.env.OKE_TEST_POSTGRES_URL?.trim() ||
  (process.env.OKE_TEST_POSTGRES === "1"
    ? (process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL)?.trim()
    : undefined);

/**
 * Wait until `path` exists on disk.
 *
 * @param path - Absolute path
 * @param timeoutMs - Deadline
 */
async function waitForFile(path: string, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await Bun.file(path).exists()) return true;
    await Bun.sleep(20);
  }
  return false;
}

/**
 * Read JSONL results written by racing children.
 *
 * @param path - JSONL file
 */
async function readJsonl(path: string): Promise<readonly Record<string, unknown>[]> {
  if (!(await Bun.file(path).exists())) return [];
  return (await Bun.file(path).text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Shared in-memory PGlite for dual-adapter (same-process) races. */
let sharedConn: SqlConnection;

beforeAll(async () => {
  sharedConn = await connectPglite({ url: "memory://vault-chaos-shared" });
}, 15_000);

afterAll(async () => {
  await sharedConn.close();
});

describe("chaos — 1. crash mid-rotation (SIGKILL)", () => {
  test("SIGKILL mid-rewrap: survivor resumes; mixed KEK generations finish cleanly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-vault-chaos-rotate-"));
    const sqlUrl = join(dir, "pgdata");
    const markerPath = join(dir, "mid.json");
    const statePath = join(dir, "state.json");
    const resultPath = join(dir, "result.json");
    const secretCount = 6;
    const killAfter = 2;

    try {
      const doomed = Bun.spawn({
        cmd: [
          "bun",
          childPath,
          "rotate-mid-rewrap",
          sqlUrl,
          markerPath,
          statePath,
          String(secretCount),
          "10",
          String(killAfter),
        ],
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(await waitForFile(markerPath)).toBe(true);
      doomed.kill(9);
      await doomed.exited;

      const survivor = Bun.spawn({
        cmd: ["bun", childPath, "resume-rewrap", sqlUrl, statePath, resultPath],
        stdout: "pipe",
        stderr: "pipe",
      });
      const code = await survivor.exited;
      const stderr = await new Response(survivor.stderr).text();
      expect(code).toBe(0);
      expect(stderr).not.toMatch(/error/i);

      const result = (await Bun.file(resultPath).json()) as {
        statusBefore: {
          rewrapTargetKekVersion?: number;
          kekVersion: number;
        };
        statusAfter: {
          rewrapTargetKekVersion?: number;
          kekVersion: number;
        };
        values: string[];
        kekVersions: number[];
        remaining: number;
      };

      // Mid-crash left a detectable in-flight rotation (not silent mixed state).
      expect(result.statusBefore.rewrapTargetKekVersion).toBe(2);
      expect(result.remaining).toBe(0);
      expect(result.statusAfter.rewrapTargetKekVersion).toBeUndefined();
      expect(result.statusAfter.kekVersion).toBe(2);
      expect(result.values).toEqual(Array.from({ length: secretCount }, (_, i) => `value-${i}`));
      expect(result.kekVersions.every((v) => v === 2)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("chaos — 2. concurrent rotateMaster", () => {
  test("two adapters on one DB: exactly one wins loud; zero DEK under unsaved key", async () => {
    await resetVaultTables(sharedConn);
    const db = sqlConnectionAsExec(sharedConn);
    const a = createBuiltinVaultAdapter({ db, kekRewrapBatchSize: 2, rotateLeaseMs: 5_000 });
    const b = createBuiltinVaultAdapter({ db, kekRewrapBatchSize: 2, rotateLeaseMs: 5_000 });
    const init = await a.initialize();
    await a.unseal(init.masterKey);
    await b.unseal(init.masterKey);
    for (let i = 0; i < 8; i += 1) {
      await a.set(`chaos/concurrent-${i}`, `v-${i}`);
    }

    const keyA = generateMasterKey();
    const keyB = generateMasterKey();
    const [ra, rb] = await Promise.allSettled([a.rotateMaster(keyA), b.rotateMaster(keyB)]);

    const fulfilled = [ra, rb].filter((r) => r.status === "fulfilled");
    const rejected = [ra, rb].filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const loser = rejected[0];
    expect(loser).toBeDefined();
    if (loser === undefined || loser.status !== "rejected") {
      throw new Error("expected exactly one rejected rotateMaster");
    }
    const rejectMsg = loser.reason instanceof Error ? loser.reason.message : String(loser.reason);
    expect(rejectMsg).toMatch(/lease held|already in progress/i);

    const winnerKey = ra.status === "fulfilled" ? keyA : keyB;
    const loserKey = ra.status === "fulfilled" ? keyB : keyA;
    const winnerAdapter = ra.status === "fulfilled" ? a : b;

    let progress =
      ra.status === "fulfilled" ? ra.value : rb.status === "fulfilled" ? rb.value : undefined;
    expect(progress).toBeDefined();
    while (progress!.remaining > 0) {
      progress = await winnerAdapter.continueRotateMaster();
    }

    // Single most important assertion: no DEK wrapped under the loser's unsaved key.
    const { createMemoryUnsealer } = await import("./unseal.ts");
    const { unwrapDek, buildAad } = await import("./crypto.ts");
    const loserUnsealer = createMemoryUnsealer(loserKey);
    const loserKek = await loserUnsealer.unwrapKek();
    const keyRows = await db.query<{
      encrypted_dek: unknown;
      dek_iv: unknown;
      dek_auth_tag: unknown;
      kek_version: number | string;
      path: string;
      version: number | string;
      algorithm: string;
    }>(
      `SELECT k.encrypted_dek, k.dek_iv, k.dek_auth_tag, k.kek_version,
              s.path, s.version, k.algorithm
       FROM oke_vault_keys k
       JOIN oke_vault_secrets s ON s.id = k.secret_id`,
    );
    const toBytes = (value: unknown): Uint8Array => {
      if (value instanceof Uint8Array) return value;
      if (typeof value === "string" && value.startsWith("\\x")) {
        return new Uint8Array(Buffer.from(value.slice(2), "hex"));
      }
      return new Uint8Array();
    };
    let loserUnwraps = 0;
    for (const row of keyRows) {
      try {
        await unwrapDek(
          loserKek,
          {
            iv: toBytes(row.dek_iv),
            ciphertext: toBytes(row.encrypted_dek),
            tag: toBytes(row.dek_auth_tag),
          },
          buildAad(
            row.path,
            Number(row.version),
            row.algorithm as "aes-256-gcm",
            Number(row.kek_version),
          ),
        );
        loserUnwraps += 1;
      } catch {
        // Expected: loser's key unwraps nothing.
      }
    }
    expect(loserUnwraps).toBe(0);

    // Winner key is the only recoverable master after completion.
    await winnerAdapter.seal();
    await winnerAdapter.unseal((await import("./crypto.ts")).masterKeyToBase64(winnerKey));
    for (let i = 0; i < 8; i += 1) {
      expect((await winnerAdapter.get(`chaos/concurrent-${i}`))?.value).toBe(`v-${i}`);
    }
    console.log(
      `[vault concurrent rotate] winner=${ra.status === "fulfilled" ? "a" : "b"} loserUnwraps=0`,
    );
  }, 30_000);
});

describe.skipIf(!LIVE_URL)("chaos — 2b. concurrent rotateMaster (multi-process Postgres)", () => {
  test("two OS processes: exactly one rotateMaster wins loud", async () => {
    const url = LIVE_URL!;
    const dir = await mkdtemp(join(tmpdir(), "oke-vault-chaos-rotate-race-"));
    const resultPath = join(dir, "results.jsonl");

    const schema = await connectPostgres({ url, pool: { max: 1 } });
    try {
      await resetVaultTables(schema);
      const adapter = createBuiltinVaultAdapter({ db: sqlConnectionAsExec(schema) });
      const init = await adapter.initialize();
      await adapter.unseal(init.masterKey);
      for (let i = 0; i < 8; i += 1) {
        await adapter.set(`chaos/race-${i}`, `race-${i}`);
      }
      await adapter.seal();

      const a = Bun.spawn({
        cmd: ["bun", childPath, "rotate-race", url, init.masterKey, "inst-a", resultPath, "8"],
        stdout: "pipe",
        stderr: "pipe",
      });
      const b = Bun.spawn({
        cmd: ["bun", childPath, "rotate-race", url, init.masterKey, "inst-b", resultPath, "8"],
        stdout: "pipe",
        stderr: "pipe",
      });
      await Promise.all([a.exited, b.exited]);

      const lines = await readJsonl(resultPath);
      expect(lines.length).toBe(2);
      const wins = lines.filter((l) => l.ok === true);
      const losses = lines.filter((l) => l.ok === false);
      console.log(`[vault pg rotate race] wins=${wins.length} losses=${losses.length}`);
      expect(wins).toHaveLength(1);
      expect(losses).toHaveLength(1);
    } finally {
      await resetVaultTables(schema).catch(() => undefined);
      await schema.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("chaos — 3. read during rotation", () => {
  test("concurrent get() during rewrap returns intact pre/post values (never torn)", async () => {
    await resetVaultTables(sharedConn);
    const db = sqlConnectionAsExec(sharedConn);
    const adapter = createBuiltinVaultAdapter({ db, kekRewrapBatchSize: 1 });
    const init = await adapter.initialize();
    await adapter.unseal(init.masterKey);
    const path = "chaos/read-during";
    const value = "stable-secret-value";
    await adapter.set(path, value);
    for (let i = 0; i < 12; i += 1) {
      await adapter.set(`chaos/pad-${i}`, `pad-${i}`);
    }

    const next = generateMasterKey();
    const reads: Array<{ ok: boolean; value?: string; error?: string }> = [];
    let stop = false;

    const reader = (async () => {
      while (!stop) {
        try {
          const secret = await adapter.get(path);
          reads.push({ ok: true, value: secret?.value });
        } catch (error) {
          reads.push({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        await Bun.sleep(0);
      }
    })();

    let progress = await adapter.rotateMaster(next);
    while (progress.remaining > 0) {
      progress = await adapter.continueRotateMaster();
    }
    stop = true;
    await reader;

    expect(reads.length).toBeGreaterThan(5);
    const bad = reads.filter((r) => !r.ok || (r.value !== undefined && r.value !== value));
    console.log(`[vault read-during-rotate] reads=${reads.length} bad=${bad.length}`);
    expect(bad).toHaveLength(0);
    expect((await adapter.get(path))?.value).toBe(value);
  }, 30_000);
});

describe.skipIf(!LIVE_URL)("chaos — 3b. read during rotation (second process, Postgres)", () => {
  test("reader process with only old master sees intact values or loud failure — never torn bytes", async () => {
    const url = LIVE_URL!;
    const dir = await mkdtemp(join(tmpdir(), "oke-vault-chaos-read-"));
    const readsPath = join(dir, "reads.jsonl");
    const stopPath = join(dir, "stop");
    const path = "chaos/cross-read";

    // Dedicated client: rotateMaster holds manual BEGIN state across
    // statements — the shared pool raises ERR_POSTGRES_UNSAFE_TRANSACTION.
    const conn = await connectPostgres({ url, pool: { max: 1 } });
    try {
      await resetVaultTables(conn);
      const adapter = createBuiltinVaultAdapter({
        db: sqlConnectionAsExec(conn),
        kekRewrapBatchSize: 1,
      });
      const init = await adapter.initialize();
      await adapter.unseal(init.masterKey);
      await adapter.set(path, "cross-process-value");
      for (let i = 0; i < 10; i += 1) {
        await adapter.set(`chaos/cross-pad-${i}`, `p-${i}`);
      }

      const reader = Bun.spawn({
        cmd: [
          "bun",
          childPath,
          "read-loop",
          url,
          init.masterKey,
          path,
          readsPath,
          stopPath,
          "15000",
        ],
        stdout: "pipe",
        stderr: "pipe",
      });

      await Bun.sleep(200);
      const next = generateMasterKey();
      let progress = await adapter.rotateMaster(next);
      while (progress.remaining > 0) {
        progress = await adapter.continueRotateMaster();
      }
      await Bun.write(stopPath, "stop");
      await reader.exited;

      const lines = await readJsonl(readsPath);
      expect(lines.length).toBeGreaterThan(0);
      const torn = lines.filter(
        (l) =>
          l.ok === true &&
          typeof l.value === "string" &&
          l.value !== "cross-process-value" &&
          l.value.length > 0,
      );
      console.log(
        `[vault pg read-during] total=${lines.length} ok=${lines.filter((l) => l.ok).length} fail=${lines.filter((l) => !l.ok).length} torn=${torn.length}`,
      );
      expect(torn).toHaveLength(0);
    } finally {
      await resetVaultTables(conn).catch(() => undefined);
      await conn.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("chaos — 4. crash mid-backup", () => {
  test("SIGKILL after partial bundle write: incomplete marker rejected before decrypt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-vault-chaos-backup-"));
    const sqlUrl = join(dir, "pgdata");
    const statePath = join(dir, "state.json");
    const bundlePath = join(dir, "vault.bundle");
    const markerPath = join(dir, "partial.json");

    try {
      const doomed = Bun.spawn({
        cmd: [
          "bun",
          childPath,
          "backup-partial",
          sqlUrl,
          statePath,
          bundlePath,
          "0.35",
          markerPath,
        ],
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await waitForFile(markerPath)).toBe(true);
      doomed.kill(9);
      await doomed.exited;

      const marker = (await Bun.file(markerPath).json()) as {
        fullBytes: number;
        writtenBytes: number;
        startsWithMagic: boolean;
      };
      expect(marker.writtenBytes).toBeLessThan(marker.fullBytes);
      expect(marker.startsWithMagic).toBe(true);

      const partial = new Uint8Array(await Bun.file(bundlePath).arrayBuffer());
      expect(new TextDecoder().decode(partial.subarray(0, BACKUP_MAGIC.length))).toBe(BACKUP_MAGIC);
      expect(
        new TextDecoder().decode(partial.subarray(Math.max(0, partial.byteLength - 32))),
      ).not.toContain(BACKUP_END_MARKER.trim());

      const state = (await Bun.file(statePath).json()) as { oldMasterKey: string };
      const conn = await connectPglite({ url: sqlUrl });
      try {
        const adapter = createBuiltinVaultAdapter({ db: sqlConnectionAsExec(conn) });
        await adapter.unseal(state.oldMasterKey);
        const failure = await adapter.importBackup(partial).catch((e: unknown) => e);
        expect(isVaultError(failure, "UNSUPPORTED")).toBe(true);
        expect((failure as Error).message).toMatch(/incomplete|checksum|end marker/i);
      } finally {
        await conn.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test("writeBackupFileAtomic: temp+fsync+rename; final path never holds a partial", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-vault-chaos-atomic-"));
    const dest = join(dir, "vault.bundle");
    try {
      await resetVaultTables(sharedConn);
      const adapter = createBuiltinVaultAdapter({ db: sqlConnectionAsExec(sharedConn) });
      const init = await adapter.initialize();
      await adapter.unseal(init.masterKey);
      await adapter.set("chaos/atomic", "payload");
      const blob = await adapter.exportBackup();
      expect(
        new TextDecoder().decode(blob.subarray(blob.byteLength - BACKUP_END_MARKER.length)),
      ).toBe(BACKUP_END_MARKER);

      await writeBackupFileAtomic(dest, blob);
      expect(await Bun.file(dest).exists()).toBe(true);
      const onDisk = new Uint8Array(await Bun.file(dest).arrayBuffer());
      expect(onDisk.byteLength).toBe(blob.byteLength);
      expect(Buffer.from(onDisk).equals(Buffer.from(blob))).toBe(true);

      // No leftover temp next to dest.
      const leftovers = await Array.fromAsync(
        new Bun.Glob("vault.bundle.oke-tmp-*").scan({ cwd: dir }),
      );
      expect(leftovers).toHaveLength(0);

      await adapter.delete("chaos/atomic");
      await adapter.importBackup(onDisk);
      expect((await adapter.get("chaos/atomic"))?.value).toBe("payload");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("chaos — 5. tampered audit via raw SQL (attacker process)", () => {
  test("separate process mutates oke_vault_audit; verifyAudit detects it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-vault-chaos-audit-"));
    const sqlUrl = join(dir, "pgdata");
    const tamperResult = join(dir, "tamper.json");

    try {
      const conn = await connectPglite({ url: sqlUrl });
      let masterKey = "";
      try {
        const adapter = createBuiltinVaultAdapter({ db: sqlConnectionAsExec(conn) });
        const init = await adapter.initialize();
        masterKey = init.masterKey;
        await adapter.unseal(masterKey);
        await adapter.set("chaos/audit", "before-tamper");
        await adapter.get("chaos/audit");
        await adapter.seal();
      } finally {
        await conn.close();
      }

      const attacker = Bun.spawn({
        cmd: ["bun", childPath, "audit-tamper", sqlUrl, tamperResult],
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await attacker.exited).toBe(0);
      const tamper = (await Bun.file(tamperResult).json()) as { ok: boolean; victim?: string };
      expect(tamper.ok).toBe(true);
      expect(tamper.victim).toBeString();

      const reopen = await connectPglite({ url: sqlUrl });
      try {
        const adapter = createBuiltinVaultAdapter({ db: sqlConnectionAsExec(reopen) });
        const result = await adapter.verifyAudit();
        expect(result.ok).toBe(false);
        expect(result.brokenAt).toBe(tamper.victim);
      } finally {
        await reopen.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("chaos — 6. multi-instance safety (dual adapter, shared PGlite)", () => {
  test("two adapters concurrent set/get: secret values intact AND audit chain verifies", async () => {
    await resetVaultTables(sharedConn);
    const db = sqlConnectionAsExec(sharedConn);
    const a = createBuiltinVaultAdapter({ db });
    const b = createBuiltinVaultAdapter({ db });
    const init = await a.initialize();
    await a.unseal(init.masterKey);
    await b.unseal(init.masterKey);

    const writers = Array.from({ length: 20 }, (_, i) => {
      const adapter = i % 2 === 0 ? a : b;
      return adapter.set(`chaos/multi-${i}`, `val-${i}`);
    });
    await Promise.all(writers);

    // Crypto path: concurrent writers must not tear secret envelopes.
    for (let i = 0; i < 20; i += 1) {
      const secret = await a.get(`chaos/multi-${i}`);
      expect(secret?.value).toBe(`val-${i}`);
    }

    const audit = await a.verifyAudit();
    console.log(`[vault multi-adapter audit] ok=${audit.ok} brokenAt=${audit.brokenAt ?? "-"}`);
    // Audit path: createSqlAuditWriter documents that concurrent appends must
    // be serialized — without FOR UPDATE / lease, racing prev_hash breaks the
    // chain (same exclusivity class as Signal competing consumers).
    expect(audit.ok).toBe(true);
  }, 30_000);
});

describe.skipIf(!LIVE_URL)("chaos — 6b. multi-instance safety (multi-process Postgres)", () => {
  test("two OS processes write distinct secrets; all readable; audit verifies", async () => {
    const url = LIVE_URL!;
    const dir = await mkdtemp(join(tmpdir(), "oke-vault-chaos-multi-"));
    const donePath = join(dir, "done.jsonl");

    const conn = await connectPostgres({ url });
    try {
      await resetVaultTables(conn);
      const adapter = createBuiltinVaultAdapter({ db: sqlConnectionAsExec(conn) });
      const init = await adapter.initialize();
      await adapter.unseal(init.masterKey);
      await adapter.seal();

      const a = Bun.spawn({
        cmd: [
          "bun",
          childPath,
          "set-race",
          url,
          init.masterKey,
          "inst-a",
          "chaos/mp",
          "12",
          donePath,
        ],
        stdout: "pipe",
        stderr: "pipe",
      });
      const b = Bun.spawn({
        cmd: [
          "bun",
          childPath,
          "set-race",
          url,
          init.masterKey,
          "inst-b",
          "chaos/mp",
          "12",
          donePath,
        ],
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await a.exited).toBe(0);
      expect(await b.exited).toBe(0);

      const done = await readJsonl(donePath);
      expect(done).toHaveLength(2);

      await adapter.unseal(init.masterKey);
      for (const inst of ["inst-a", "inst-b"] as const) {
        for (let i = 0; i < 12; i += 1) {
          const secret = await adapter.get(`chaos/mp/${inst}-${i}`);
          expect(secret?.value).toBe(`${inst}-value-${i}`);
        }
      }
      const audit = await adapter.verifyAudit();
      console.log(
        `[vault pg multi-process audit] ok=${audit.ok} brokenAt=${audit.brokenAt ?? "-"}`,
      );
      expect(audit.ok).toBe(true);
    } finally {
      await resetVaultTables(conn).catch(() => undefined);
      await conn.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe.skipIf(Boolean(LIVE_URL))("chaos — postgres multi-process (skipped)", () => {
  test("skip: vault multi-process chaos (set OKE_TEST_POSTGRES_URL or OKE_TEST_POSTGRES=1 + DATABASE_URL)", () => {
    expect(LIVE_URL).toBeUndefined();
  });
});
