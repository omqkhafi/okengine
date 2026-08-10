/**
 * Built-in Vault adapter — seal physics, versioning, rotation, audit chain.
 *
 * Runs against a real PGlite instance so the SQL (DDL, `bytea` round-trip,
 * `DISTINCT ON`, `jsonb`) is exercised rather than mocked.
 *
 * One warmed in-memory PGlite is shared for the whole file (cold WASM once);
 * {@link resetVaultTables} isolates each test without a fresh `PGlite.create`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connectPglite } from "../../drivers/pglite.ts";
import type { SqlConnection } from "../../drivers/types.ts";
import {
  createBuiltinVaultAdapter,
  sqlConnectionAsExec,
  type BuiltinVaultAdapter,
} from "./builtin-adapter.ts";
import { generateMasterKey, masterKeyToBase64 } from "./crypto.ts";
import { isVaultError, VaultError } from "./errors.ts";
import type { SqlExec } from "./storage.ts";
import { resetVaultTables } from "./test-helpers.ts";

const PATH = "prod/api/stripe";
const VALUE = "sk_live_do_not_log_me";

/** File-scoped warmed PGlite — opened in {@link beforeAll}. */
let sharedConn: SqlConnection;

beforeAll(async () => {
  sharedConn = await connectPglite({ url: "memory://vault-adapter-shared" });
}, 15_000);

afterAll(async () => {
  await sharedConn.close();
});

/**
 * Adapt a driver connection to the Vault's {@link SqlExec} surface.
 *
 * @param conn - Open PGlite connection
 */
function asExec(conn: SqlConnection): SqlExec {
  return sqlConnectionAsExec(conn);
}

/** An initialized, unsealed adapter over the shared PGlite, plus a no-op close. */
interface Harness {
  readonly adapter: BuiltinVaultAdapter;
  readonly db: SqlExec;
  readonly masterKey: string;
  close(): Promise<void>;
}

/**
 * Boot an initialized, unsealed adapter over the shared PGlite (tables reset).
 *
 * @param options - Rewrap batch size for rotation tests
 */
async function harness(options: { batchSize?: number } = {}): Promise<Harness> {
  await resetVaultTables(sharedConn);
  const db = asExec(sharedConn);
  const adapter = createBuiltinVaultAdapter({
    db,
    ...(options.batchSize === undefined ? {} : { kekRewrapBatchSize: options.batchSize }),
  });
  const init = await adapter.initialize();
  await adapter.unseal(init.masterKey);
  return {
    adapter,
    db,
    masterKey: init.masterKey,
    async close() {
      /* shared connection — closed in afterAll */
    },
  };
}

describe("builtin vault adapter — lifecycle", () => {
  test("initialize returns the master key once and refuses a second run", async () => {
    await resetVaultTables(sharedConn);
    const adapter = createBuiltinVaultAdapter({ db: asExec(sharedConn) });
    const init = await adapter.initialize();

    expect(init.masterKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(init.verifyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(init.kekVersion).toBe(1);

    const status = await adapter.status();
    expect(status.initialized).toBe(true);
    expect(status.sealed).toBe(true);
    expect(status.masterKeyPresent).toBe(true);

    const failure = await adapter.initialize().catch((e: unknown) => e);
    expect(isVaultError(failure, "ALREADY_INITIALIZED")).toBe(true);
  });

  test("unseal + set/get round-trips a secret", async () => {
    const h = await harness();
    try {
      const written = await h.adapter.set(PATH, VALUE, { metadata: { owner: "billing" } });
      expect(written.version).toBe(1);
      expect(written.kekVersion).toBe(1);
      expect(written.metadata).toEqual({ owner: "billing" });

      const read = await h.adapter.get(PATH);
      expect(read?.value).toBe(VALUE);
      expect(read?.version).toBe(1);
      expect(read?.metadata).toEqual({ owner: "billing" });
      expect(read?.algorithm).toBe("aes-256-gcm");
    } finally {
      await h.close();
    }
  });

  test("nothing readable is stored in cleartext", async () => {
    const h = await harness();
    try {
      await h.adapter.set(PATH, VALUE);
      const rows = await h.db.query<{ encrypted_value: Uint8Array }>(
        `SELECT encrypted_value FROM oke_vault_secrets`,
      );
      const stored = Buffer.from(rows[0]!.encrypted_value).toString("utf8");
      expect(stored).not.toContain("sk_live");
    } finally {
      await h.close();
    }
  });

  test("a sealed vault rejects reads and writes", async () => {
    const h = await harness();
    try {
      await h.adapter.set(PATH, VALUE);
      await h.adapter.seal();

      expect((await h.adapter.status()).sealed).toBe(true);
      expect(h.adapter.getUnsealer()).toBeNull();

      const read = await h.adapter.get(PATH).catch((e: unknown) => e);
      expect(isVaultError(read, "SEALED")).toBe(true);
      const write = await h.adapter.set(PATH, "x").catch((e: unknown) => e);
      expect(isVaultError(write, "SEALED")).toBe(true);

      await h.adapter.unseal(h.masterKey);
      expect((await h.adapter.get(PATH))?.value).toBe(VALUE);
    } finally {
      await h.close();
    }
  });

  test("the wrong master key cannot unseal", async () => {
    const h = await harness();
    try {
      await h.adapter.seal();
      const wrong = masterKeyToBase64(generateMasterKey());
      const failure = await h.adapter.unseal(wrong).catch((e: unknown) => e);
      expect(isVaultError(failure, "INVALID_KEY")).toBe(true);
      expect((failure as VaultError).message).not.toContain(wrong);
      expect(h.adapter.getUnsealer()).toBeNull();
    } finally {
      await h.close();
    }
  });
});

describe("builtin vault adapter — versions and listing", () => {
  test("each write adds a version and reads return the newest", async () => {
    const h = await harness();
    try {
      await h.adapter.set(PATH, "v1");
      const second = await h.adapter.set(PATH, "v2");
      const third = await h.adapter.rotate(PATH, "v3");

      expect(second.version).toBe(2);
      expect(third.version).toBe(3);
      expect((await h.adapter.get(PATH))?.value).toBe("v3");
      expect((await h.adapter.get(PATH, { version: 1 }))?.value).toBe("v1");
    } finally {
      await h.close();
    }
  });

  test("soft delete hides every version and a later write keeps counting up", async () => {
    const h = await harness();
    try {
      await h.adapter.set(PATH, "v1");
      await h.adapter.set(PATH, "v2");

      expect(await h.adapter.delete(PATH)).toBe(true);
      expect(await h.adapter.delete(PATH)).toBe(false);
      expect(await h.adapter.get(PATH)).toBeUndefined();
      expect((await h.adapter.list()).map((e) => e.path)).toEqual([]);
      expect((await h.adapter.list({ includeDeleted: true })).map((e) => e.path)).toEqual([PATH]);

      const revived = await h.adapter.set(PATH, "v3");
      expect(revived.version).toBe(3);
      expect((await h.adapter.get(PATH))?.value).toBe("v3");
    } finally {
      await h.close();
    }
  });

  test("list reports one entry per path and honours a prefix", async () => {
    const h = await harness();
    try {
      await h.adapter.set("prod/api/stripe", "a");
      await h.adapter.set("prod/api/stripe", "b");
      await h.adapter.set("prod/db/main", "c");
      await h.adapter.set("staging/api/stripe", "d");

      const all = await h.adapter.list();
      expect(all.map((e) => e.path)).toEqual([
        "prod/api/stripe",
        "prod/db/main",
        "staging/api/stripe",
      ]);
      expect(all[0]?.version).toBe(2);

      const scoped = await h.adapter.list({ prefix: "prod/api" });
      expect(scoped.map((e) => e.path)).toEqual(["prod/api/stripe"]);

      expect((await h.adapter.status()).secretCount).toBe(3);
    } finally {
      await h.close();
    }
  });

  test("an expired secret fails closed unless the caller opts in", async () => {
    const h = await harness();
    try {
      await h.adapter.set(PATH, VALUE, { expiresAt: new Date(Date.now() - 1_000) });

      const failure = await h.adapter.get(PATH).catch((e: unknown) => e);
      expect(isVaultError(failure, "EXPIRED")).toBe(true);
      expect((await h.adapter.get(PATH, { allowExpired: true }))?.value).toBe(VALUE);
    } finally {
      await h.close();
    }
  });

  test("paths are canonicalized and traversal is rejected", async () => {
    const h = await harness();
    try {
      await h.adapter.set("/prod//api///stripe/", VALUE);
      expect((await h.adapter.get(PATH))?.value).toBe(VALUE);
      await expect(h.adapter.get("prod/../etc")).rejects.toThrow(VaultError);
    } finally {
      await h.close();
    }
  });
});

describe("builtin vault adapter — master rotation", () => {
  test("rotateMaster re-wraps every DEK and secrets stay readable", async () => {
    const h = await harness({ batchSize: 2 });
    try {
      for (let i = 0; i < 5; i += 1) {
        await h.adapter.set(`prod/api/key-${i}`, `value-${i}`);
      }

      const next = generateMasterKey();
      let progress = await h.adapter.rotateMaster(next);
      expect(progress.kekVersion).toBe(2);
      expect(progress.remaining).toBe(3);

      // Mid-rewrap the vault dual-reads both KEK generations.
      expect((await h.adapter.get("prod/api/key-0"))?.value).toBe("value-0");
      expect((await h.adapter.get("prod/api/key-4"))?.value).toBe("value-4");

      while (progress.remaining > 0) {
        progress = await h.adapter.continueRotateMaster();
      }
      expect(progress.remaining).toBe(0);
      expect((await h.adapter.status()).kekVersion).toBe(2);

      for (let i = 0; i < 5; i += 1) {
        const secret = await h.adapter.get(`prod/api/key-${i}`);
        expect(secret?.value).toBe(`value-${i}`);
        expect(secret?.kekVersion).toBe(2);
      }

      // The old master key is retired; only the new one unseals.
      await h.adapter.seal();
      const stale = await h.adapter.unseal(h.masterKey).catch((e: unknown) => e);
      expect(isVaultError(stale, "INVALID_KEY")).toBe(true);
      await h.adapter.unseal(masterKeyToBase64(next));
      expect((await h.adapter.get("prod/api/key-2"))?.value).toBe("value-2");
    } finally {
      await h.close();
    }
  });

  test("rotateMaster without a key returns the generated one exactly once", async () => {
    const h = await harness();
    try {
      await h.adapter.set(PATH, VALUE);
      const progress = await h.adapter.rotateMaster();
      expect(progress.remaining).toBe(0);
      expect(progress.masterKey).toBeString();

      await h.adapter.seal();
      await h.adapter.unseal(progress.masterKey!);
      expect((await h.adapter.get(PATH))?.value).toBe(VALUE);
    } finally {
      await h.close();
    }
  });

  test("continueRotateMaster without a rotation in flight is rejected", async () => {
    const h = await harness();
    try {
      const failure = await h.adapter.continueRotateMaster().catch((e: unknown) => e);
      expect(isVaultError(failure, "UNSUPPORTED")).toBe(true);
    } finally {
      await h.close();
    }
  });

  test("rotateMaster: concurrent callers — exactly one wins, loser fails before any DEK rewrite", async () => {
    const h = await harness({ batchSize: 2 });
    try {
      for (let i = 0; i < 6; i += 1) {
        await h.adapter.set(`prod/race/${i}`, `v-${i}`);
      }
      const other = createBuiltinVaultAdapter({
        db: h.db,
        kekRewrapBatchSize: 2,
        rotateLeaseMs: 5_000,
      });
      await other.unseal(h.masterKey);

      const keyA = generateMasterKey();
      const keyB = generateMasterKey();
      const before = await h.db.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM oke_vault_keys WHERE kek_version = 2`,
      );
      expect(before[0]?.n).toBe("0");

      const [ra, rb] = await Promise.allSettled([
        h.adapter.rotateMaster(keyA),
        other.rotateMaster(keyB),
      ]);
      expect([ra, rb].filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect([ra, rb].filter((r) => r.status === "rejected")).toHaveLength(1);

      const loser = ra.status === "rejected" ? ra : rb;
      expect(
        loser.status === "rejected" && loser.reason instanceof Error ? loser.reason.message : "",
      ).toMatch(/lease held|already in progress/i);

      // Loser must not have wrapped any DEK under its key: at most the winner's batch.
      const mid = await h.db.query<{ kek_version: string; n: string }>(
        `SELECT kek_version::text, COUNT(*)::text AS n FROM oke_vault_keys GROUP BY kek_version ORDER BY 1`,
      );
      const v2 = mid.find((r) => r.kek_version === "2");
      expect(Number(v2?.n ?? "0")).toBeLessThanOrEqual(2);
    } finally {
      await h.close();
    }
  });

  test("continueRotateMaster cold-resumes from rewrap_key_hash after process death", async () => {
    await resetVaultTables(sharedConn);
    const db = asExec(sharedConn);
    const first = createBuiltinVaultAdapter({ db, kekRewrapBatchSize: 2 });
    const init = await first.initialize();
    await first.unseal(init.masterKey);
    for (let i = 0; i < 5; i += 1) {
      await first.set(`prod/api/key-${i}`, `value-${i}`);
    }

    const next = generateMasterKey();
    const nextB64 = masterKeyToBase64(next);
    let progress = await first.rotateMaster(next);
    expect(progress.remaining).toBe(3);
    expect((await first.status()).rewrapTargetKekVersion).toBe(2);

    // Simulate process death: drop in-memory pending, expire the rotate lease
    // (lazy reclaim — same physics as SIGKILL + lease TTL).
    await db.execute(`UPDATE oke_vault_status SET rotate_lease_expires_at = $1 WHERE id = 1`, [
      Date.now() - 1,
    ]);
    const second = createBuiltinVaultAdapter({ db, kekRewrapBatchSize: 2 });
    await second.unseal(init.masterKey);
    expect((await second.status()).rewrapTargetKekVersion).toBe(2);

    const wrong = await second.continueRotateMaster().catch((e: unknown) => e);
    expect(isVaultError(wrong, "INVALID_KEY")).toBe(true);

    progress = await second.continueRotateMaster(nextB64);
    while (progress.remaining > 0) {
      progress = await second.continueRotateMaster(nextB64);
    }
    expect(progress.remaining).toBe(0);
    expect((await second.status()).kekVersion).toBe(2);
    expect((await second.status()).rewrapTargetKekVersion).toBeUndefined();

    for (let i = 0; i < 5; i += 1) {
      expect((await second.get(`prod/api/key-${i}`))?.value).toBe(`value-${i}`);
    }

    await second.seal();
    const stale = await second.unseal(init.masterKey).catch((e: unknown) => e);
    expect(isVaultError(stale, "INVALID_KEY")).toBe(true);
    await second.unseal(nextB64);
    expect((await second.get("prod/api/key-0"))?.value).toBe("value-0");
  });
});

describe("builtin vault adapter — audit and backup", () => {
  test("the audit chain verifies after a full run of operations", async () => {
    const h = await harness();
    try {
      await h.adapter.set(PATH, VALUE);
      await h.adapter.get(PATH);
      await h.adapter.rotate(PATH, "v2");
      await h.adapter.list();
      await h.adapter.delete(PATH);
      await h.adapter.seal();
      await h.adapter.unseal(h.masterKey);

      expect(await h.adapter.verifyAudit()).toEqual({ ok: true });

      const rows = await h.db.query<{ action: string; path: string | null }>(
        `SELECT action, path FROM oke_vault_audit ORDER BY seq ASC`,
      );
      expect(rows.map((r) => r.action)).toContain("initialize");
      expect(rows.map((r) => r.action)).toContain("rotate");
      expect(rows.every((r) => r.path === null || !r.path.includes("sk_live"))).toBe(true);
    } finally {
      await h.close();
    }
  });

  test("a tampered audit row is reported with its id", async () => {
    const h = await harness();
    try {
      await h.adapter.set(PATH, VALUE);
      await h.adapter.get(PATH);
      const rows = await h.db.query<{ id: string }>(
        `SELECT id FROM oke_vault_audit ORDER BY seq ASC`,
      );
      const victim = rows[1]!.id;
      await h.db.execute(`UPDATE oke_vault_audit SET action = 'delete' WHERE id = $1`, [victim]);

      const result = await h.adapter.verifyAudit();
      expect(result.ok).toBe(false);
      expect(result.brokenAt).toBe(victim);
    } finally {
      await h.close();
    }
  });

  test("purgeAuditBefore drops old rows and the retained chain still verifies", async () => {
    const h = await harness();
    try {
      await h.adapter.set(PATH, VALUE);
      const removed = await h.adapter.purgeAuditBefore(new Date(Date.now() + 60_000));
      expect(removed).toBeGreaterThan(0);
      expect(await h.adapter.verifyAudit()).toEqual({ ok: true });
    } finally {
      await h.close();
    }
  });

  test("purgeExpired dry-run counts then hard-deletes expired rows", async () => {
    const h = await harness();
    try {
      await h.adapter.set("app/live", "keep-me");
      await h.adapter.set("app/stale", "drop-me", {
        expiresAt: new Date(Date.now() - 60_000),
      });

      const dry = await h.adapter.purgeExpired({ dryRun: true });
      expect(dry.count).toBe(1);
      expect(dry.paths).toEqual(["app/stale"]);
      // Dry-run must not remove rows.
      expect(
        (
          await h.db.query<{ n: string }>(
            `SELECT COUNT(*)::text AS n FROM oke_vault_secrets WHERE path = $1`,
            ["app/stale"],
          )
        )[0]?.n,
      ).toBe("1");

      const live = await h.adapter.purgeExpired();
      expect(live.count).toBe(1);
      expect(
        (
          await h.db.query<{ n: string }>(
            `SELECT COUNT(*)::text AS n FROM oke_vault_secrets WHERE path = $1`,
            ["app/stale"],
          )
        )[0]?.n,
      ).toBe("0");
      expect((await h.adapter.get("app/live"))?.value).toBe("keep-me");

      const audit = await h.adapter.listAudit({ limit: 5 });
      const purge = audit.find((r) => r.action === "purge" && r.errorMessage?.includes("expired"));
      expect(purge?.errorMessage).toBe("expired count=1");
      // No per-path audit bloat for the purge itself.
      expect(purge?.path).toBeNull();
    } finally {
      await h.close();
    }
  });

  test("backup round-trips through the backup KEK and rejects foreign bytes", async () => {
    const h = await harness();
    try {
      await h.adapter.set("prod/api/stripe", "a");
      await h.adapter.set("prod/db/main", "b", { metadata: { tier: "primary" } });

      const blob = await h.adapter.exportBackup();
      expect(Buffer.from(blob).toString("utf8")).toStartWith("oke-vault-backup-v1\n");
      expect(Buffer.from(blob).toString("utf8")).toEndWith("oke-vault-backup-end\n");
      expect(Buffer.from(blob).toString("utf8")).not.toContain("prod/db/main");

      await h.adapter.delete("prod/api/stripe");
      await h.adapter.delete("prod/db/main");
      expect(await h.adapter.list()).toHaveLength(0);

      await h.adapter.importBackup(blob);
      expect((await h.adapter.get("prod/api/stripe"))?.value).toBe("a");
      const restored = await h.adapter.get("prod/db/main");
      expect(restored?.value).toBe("b");
      expect(restored?.metadata).toEqual({ tier: "primary" });

      const junk = await h.adapter.importBackup(new Uint8Array([1, 2, 3])).catch((e: unknown) => e);
      expect(isVaultError(junk, "UNSUPPORTED")).toBe(true);
    } finally {
      await h.close();
    }
  });
});
