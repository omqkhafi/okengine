/**
 * Vault-builtin chaos child — real OS process for adversarial proofs.
 *
 * Args:
 *   rotate-mid-rewrap <sqlUrl> <markerPath> <statePath> <secretCount> <batchSize> <killAfter>
 *   resume-rewrap <sqlUrl> <statePath> <resultPath>
 *   backup-partial <sqlUrl> <statePath> <bundlePath> <fraction> <markerPath>
 *   audit-tamper <sqlUrl> <resultPath>
 *   rotate-race <sqlUrl> <masterKey> <instanceId> <resultPath> <secretCount>
 *   read-loop <sqlUrl> <masterKey> <path> <readsPath> <stopPath> <durationMs>
 *   set-race <sqlUrl> <masterKey> <instanceId> <pathPrefix> <count> <donePath>
 *
 * Modes:
 *   rotate-mid-rewrap — seed secrets, start rotateMaster, hang after N DEK
 *                       UPDATEs (parent SIGKILLs mid-rewrap)
 *   resume-rewrap     — cold-resume continueRotateMaster until remaining=0
 *   backup-partial    — exportBackup then write only a fraction of the blob
 *   audit-tamper      — raw SQL UPDATE on oke_vault_audit (bypass adapter)
 *   rotate-race       — call rotateMaster once; write ok/error JSON
 *   read-loop         — get(path) until stopPath appears or duration elapses
 *   set-race          — write `count` distinct paths; append to donePath
 */

import { connectPglite } from "../../drivers/pglite.ts";
import { connectPostgres } from "../../drivers/postgres.ts";
import type { SqlConnection } from "../../drivers/types.ts";
import {
  createBuiltinVaultAdapter,
  sqlConnectionAsExec,
  type BuiltinVaultAdapter,
} from "./builtin-adapter.ts";
import { generateMasterKey, masterKeyToBase64 } from "./crypto.ts";
import type { SqlExec } from "./storage.ts";

const mode = process.argv[2];

if (!mode) {
  console.error(
    "usage: chaos-child <rotate-mid-rewrap|resume-rewrap|backup-partial|audit-tamper|rotate-race|read-loop|set-race> …",
  );
  process.exit(2);
}

/** Persisted across SIGKILL so the survivor can resume. */
interface RotateState {
  readonly oldMasterKey: string;
  readonly newMasterKey: string;
  readonly secretCount: number;
  readonly killAfter: number;
}

/**
 * Open the SQL backend the parent handed us (Postgres URL or PGlite datadir).
 *
 * @param sqlUrl - `postgres://…` or on-disk PGlite path
 */
async function openSql(sqlUrl: string): Promise<SqlConnection> {
  if (/^postgres(ql)?:\/\//.test(sqlUrl)) {
    return connectPostgres({ url: sqlUrl });
  }
  return connectPglite({ url: sqlUrl });
}

/**
 * Wrap `db.execute` so the Nth `oke_vault_keys` rewrap UPDATE hangs.
 *
 * @param db - Underlying exec
 * @param killAfter - Hang after this many DEK rewrap UPDATEs
 * @param onReady - Called once before the hang (write marker / state)
 */
function hangAfterRewrapUpdates(
  db: SqlExec,
  killAfter: number,
  onReady: () => Promise<void>,
): SqlExec {
  let updates = 0;
  let armed = false;
  const wrapped: SqlExec = {
    query: <T>(sql: string, params?: unknown[]) => db.query<T>(sql, params),
    execute: async (sql: string, params?: unknown[]) => {
      await db.execute(sql, params);
      if (!/UPDATE\s+oke_vault_keys/i.test(sql) || !/kek_version/i.test(sql)) return;
      updates += 1;
      if (updates === killAfter && !armed) {
        armed = true;
        await onReady();
        await Bun.sleep(120_000);
      }
    },
  };
  if (db.begin) {
    wrapped.begin = <T>(fn: (tx: SqlExec) => Promise<T>) => db.begin!(fn);
  }
  return wrapped;
}

/**
 * Seed `secretCount` secrets under a fresh vault; return adapter + keys.
 *
 * @param db - SQL surface
 * @param secretCount - How many DEKs to create
 * @param batchSize - Rewrap batch size
 */
async function seedVault(
  db: SqlExec,
  secretCount: number,
  batchSize: number,
  rotateLeaseMs = 150,
): Promise<{ adapter: BuiltinVaultAdapter; oldMasterKey: string }> {
  const adapter = createBuiltinVaultAdapter({
    db,
    kekRewrapBatchSize: batchSize,
    rotateLeaseMs,
  });
  const init = await adapter.initialize();
  await adapter.unseal(init.masterKey);
  for (let i = 0; i < secretCount; i += 1) {
    await adapter.set(`chaos/secret-${i}`, `value-${i}`);
  }
  return { adapter, oldMasterKey: init.masterKey };
}

if (mode === "rotate-mid-rewrap") {
  const sqlUrl = process.argv[3];
  const markerPath = process.argv[4];
  const statePath = process.argv[5];
  const secretCount = Number(process.argv[6] ?? "6");
  const batchSize = Number(process.argv[7] ?? "10");
  const killAfter = Number(process.argv[8] ?? "2");
  if (!sqlUrl || !markerPath || !statePath) {
    console.error(
      "usage: rotate-mid-rewrap <sqlUrl> <markerPath> <statePath> <secretCount> <batchSize> <killAfter>",
    );
    process.exit(2);
  }

  const conn = await openSql(sqlUrl);
  const base = sqlConnectionAsExec(conn);
  const next = generateMasterKey();
  const nextB64 = masterKeyToBase64(next);
  let oldMasterKey = "";

  const db = hangAfterRewrapUpdates(base, killAfter, async () => {
    const state: RotateState = {
      oldMasterKey,
      newMasterKey: nextB64,
      secretCount,
      killAfter,
    };
    await Bun.write(statePath, JSON.stringify(state));
    await Bun.write(markerPath, JSON.stringify({ readyAt: Date.now(), killAfter, secretCount }));
  });

  const seeded = await seedVault(db, secretCount, batchSize);
  oldMasterKey = seeded.oldMasterKey;
  // rotateMaster runs until the interceptor hangs mid-batch.
  await seeded.adapter.rotateMaster(next);
  console.error("rotate-mid-rewrap: rotateMaster returned (should have hung)");
  process.exit(3);
}

if (mode === "resume-rewrap") {
  const sqlUrl = process.argv[3];
  const statePath = process.argv[4];
  const resultPath = process.argv[5];
  if (!sqlUrl || !statePath || !resultPath) {
    console.error("usage: resume-rewrap <sqlUrl> <statePath> <resultPath>");
    process.exit(2);
  }

  const state = (await Bun.file(statePath).json()) as RotateState;
  const conn = await openSql(sqlUrl);
  try {
    const adapter = createBuiltinVaultAdapter({
      db: sqlConnectionAsExec(conn),
      kekRewrapBatchSize: 2,
      rotateLeaseMs: 150,
    });
    await adapter.unseal(state.oldMasterKey);
    const statusBefore = await adapter.status();

    // Lazy reclaim: wait out the dead holder's lease (Clock/Signal physics).
    let progress: { remaining: number; kekVersion: number } | undefined;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        progress = await adapter.continueRotateMaster(state.newMasterKey);
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("lease held")) throw error;
        await Bun.sleep(40);
      }
    }
    if (!progress) {
      console.error("resume-rewrap: timed out waiting for rotate lease reclaim");
      process.exit(3);
    }
    while (progress.remaining > 0) {
      progress = await adapter.continueRotateMaster(state.newMasterKey);
    }

    const values: string[] = [];
    const kekVersions: number[] = [];
    for (let i = 0; i < state.secretCount; i += 1) {
      const secret = await adapter.get(`chaos/secret-${i}`);
      values.push(secret?.value ?? "<missing>");
      kekVersions.push(secret?.kekVersion ?? -1);
    }
    const statusAfter = await adapter.status();
    await Bun.write(
      resultPath,
      JSON.stringify({
        statusBefore,
        statusAfter,
        values,
        kekVersions,
        remaining: progress.remaining,
      }),
    );
    process.exit(0);
  } finally {
    await conn.close();
  }
}

if (mode === "backup-partial") {
  const sqlUrl = process.argv[3];
  const statePath = process.argv[4];
  const bundlePath = process.argv[5];
  const fraction = Number(process.argv[6] ?? "0.4");
  const markerPath = process.argv[7];
  if (!sqlUrl || !statePath || !bundlePath || !markerPath) {
    console.error(
      "usage: backup-partial <sqlUrl> <statePath> <bundlePath> <fraction> <markerPath>",
    );
    process.exit(2);
  }

  const conn = await openSql(sqlUrl);
  try {
    const { adapter, oldMasterKey } = await seedVault(sqlConnectionAsExec(conn), 4, 100);
    await Bun.write(statePath, JSON.stringify({ oldMasterKey }));
    const blob = await adapter.exportBackup();
    const keep = Math.max(1, Math.floor(blob.byteLength * fraction));
    // Simulate crash mid-Bun.write: durable partial file with magic header.
    await Bun.write(bundlePath, blob.subarray(0, keep));
    await Bun.write(
      markerPath,
      JSON.stringify({
        fullBytes: blob.byteLength,
        writtenBytes: keep,
        startsWithMagic: new TextDecoder()
          .decode(blob.subarray(0, 20))
          .startsWith("oke-vault-backup"),
      }),
    );
    // Hang so the parent can SIGKILL after the partial file is on disk.
    await Bun.sleep(120_000);
  } finally {
    await conn.close();
  }
  process.exit(3);
}

if (mode === "audit-tamper") {
  const sqlUrl = process.argv[3];
  const resultPath = process.argv[4];
  if (!sqlUrl || !resultPath) {
    console.error("usage: audit-tamper <sqlUrl> <resultPath>");
    process.exit(2);
  }

  const conn = await openSql(sqlUrl);
  try {
    // Attacker path: raw driver SQL, no BuiltinVaultAdapter involved.
    const rows = await conn.query(
      `SELECT id FROM oke_vault_audit ORDER BY seq ASC LIMIT 5 OFFSET 1`,
    );
    const victim = (rows[0] as { id?: string } | undefined)?.id;
    if (!victim) {
      await Bun.write(resultPath, JSON.stringify({ ok: false, error: "no-victim-row" }));
      process.exit(3);
    }
    await conn.exec(`UPDATE oke_vault_audit SET action = 'delete' WHERE id = $1`, [victim]);
    await Bun.write(resultPath, JSON.stringify({ ok: true, victim }));
    process.exit(0);
  } finally {
    await conn.close();
  }
}

if (mode === "rotate-race") {
  const sqlUrl = process.argv[3];
  const masterKey = process.argv[4];
  const instanceId = process.argv[5];
  const resultPath = process.argv[6];
  const secretCount = Number(process.argv[7] ?? "8");
  if (!sqlUrl || !masterKey || !instanceId || !resultPath) {
    console.error(
      "usage: rotate-race <sqlUrl> <masterKey> <instanceId> <resultPath> [secretCount]",
    );
    process.exit(2);
  }

  const conn = await openSql(sqlUrl);
  try {
    const adapter = createBuiltinVaultAdapter({
      db: sqlConnectionAsExec(conn),
      kekRewrapBatchSize: 2,
    });
    await adapter.unseal(masterKey);
    // Ensure enough DEKs exist (idempotent if the seeder already wrote them).
    for (let i = 0; i < secretCount; i += 1) {
      const existing = await adapter.get(`chaos/race-${i}`);
      if (!existing) await adapter.set(`chaos/race-${i}`, `race-${i}`);
    }
    try {
      const progress = await adapter.rotateMaster();
      const line = `${JSON.stringify({
        instanceId,
        ok: true,
        remaining: progress.remaining,
        kekVersion: progress.kekVersion,
        masterKey: progress.masterKey,
        at: Date.now(),
      })}\n`;
      const prev = (await Bun.file(resultPath).exists()) ? await Bun.file(resultPath).text() : "";
      await Bun.write(resultPath, prev + line);
      process.exit(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const line = `${JSON.stringify({
        instanceId,
        ok: false,
        error: message,
        at: Date.now(),
      })}\n`;
      const prev = (await Bun.file(resultPath).exists()) ? await Bun.file(resultPath).text() : "";
      await Bun.write(resultPath, prev + line);
      process.exit(0);
    }
  } finally {
    await conn.close();
  }
}

if (mode === "read-loop") {
  const sqlUrl = process.argv[3];
  const masterKey = process.argv[4];
  const path = process.argv[5];
  const readsPath = process.argv[6];
  const stopPath = process.argv[7];
  const durationMs = Number(process.argv[8] ?? "8000");
  if (!sqlUrl || !masterKey || !path || !readsPath || !stopPath) {
    console.error(
      "usage: read-loop <sqlUrl> <masterKey> <path> <readsPath> <stopPath> [durationMs]",
    );
    process.exit(2);
  }

  const conn = await openSql(sqlUrl);
  try {
    const adapter = createBuiltinVaultAdapter({ db: sqlConnectionAsExec(conn) });
    await adapter.unseal(masterKey);
    const deadline = Date.now() + durationMs;
    while (Date.now() < deadline) {
      if (await Bun.file(stopPath).exists()) break;
      try {
        const secret = await adapter.get(path);
        const line = `${JSON.stringify({
          ok: true,
          value: secret?.value ?? null,
          kekVersion: secret?.kekVersion ?? null,
          at: Date.now(),
        })}\n`;
        const prev = (await Bun.file(readsPath).exists()) ? await Bun.file(readsPath).text() : "";
        await Bun.write(readsPath, prev + line);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const line = `${JSON.stringify({ ok: false, error: message, at: Date.now() })}\n`;
        const prev = (await Bun.file(readsPath).exists()) ? await Bun.file(readsPath).text() : "";
        await Bun.write(readsPath, prev + line);
      }
      await Bun.sleep(5);
    }
    process.exit(0);
  } finally {
    await conn.close();
  }
}

if (mode === "set-race") {
  const sqlUrl = process.argv[3];
  const masterKey = process.argv[4];
  const instanceId = process.argv[5];
  const pathPrefix = process.argv[6];
  const count = Number(process.argv[7] ?? "10");
  const donePath = process.argv[8];
  if (!sqlUrl || !masterKey || !instanceId || !pathPrefix || !donePath) {
    console.error(
      "usage: set-race <sqlUrl> <masterKey> <instanceId> <pathPrefix> <count> <donePath>",
    );
    process.exit(2);
  }

  const conn = await openSql(sqlUrl);
  try {
    const adapter = createBuiltinVaultAdapter({ db: sqlConnectionAsExec(conn) });
    await adapter.unseal(masterKey);
    for (let i = 0; i < count; i += 1) {
      await adapter.set(`${pathPrefix}/${instanceId}-${i}`, `${instanceId}-value-${i}`);
    }
    const line = `${JSON.stringify({ instanceId, count, at: Date.now() })}\n`;
    const prev = (await Bun.file(donePath).exists()) ? await Bun.file(donePath).text() : "";
    await Bun.write(donePath, prev + line);
    process.exit(0);
  } finally {
    await conn.close();
  }
}

console.error(`unknown mode: ${mode}`);
process.exit(2);
