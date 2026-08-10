/**
 * Phase 10 security checklist — threat-model assertions for the built-in vault.
 *
 * SQL-backed cases use the in-memory Vault SQL fake: these tests assert seal
 * physics and audit integrity, not Postgres dialect / pgvector behavior.
 */

import { describe, expect, test } from "bun:test";
import type { SqlConnection } from "../../drivers/types.ts";
import {
  createBuiltinVaultAdapter,
  sqlConnectionAsExec,
  type BuiltinVaultAdapter,
} from "./builtin-adapter.ts";
import {
  ALGORITHM,
  buildAad,
  decryptSecret,
  encryptSecret,
  generateDek,
  importAesKey,
  unwrapDek,
  wrapDek,
} from "./crypto.ts";
import { VaultError } from "./errors.ts";
import { canonicalizePath } from "./path.ts";
import type { SqlExec } from "./storage.ts";
import { createMemoryVaultSql } from "./test-helpers.ts";
import { createMemoryUnsealer } from "./unseal.ts";

/** Fresh initialized + unsealed adapter over the in-memory Vault SQL fake. */
async function harness(): Promise<{
  adapter: BuiltinVaultAdapter;
  db: SqlExec;
  conn: SqlConnection;
  close(): Promise<void>;
}> {
  const conn = createMemoryVaultSql();
  const db = sqlConnectionAsExec(conn);
  const adapter = createBuiltinVaultAdapter({ db });
  const init = await adapter.initialize!();
  await adapter.unseal!(init.masterKey);
  return {
    adapter,
    db,
    conn,
    async close() {
      await conn.close();
    },
  };
}

describe("vault security checklist", () => {
  test("DB rows never contain the cleartext secret", async () => {
    const h = await harness();
    try {
      const secret = `sk_live_${crypto.randomUUID()}`;
      await h.adapter.set("prod/api/stripe", secret);
      const rows = await h.conn.query("select encrypted_value from oke_vault_secrets");
      for (const row of rows) {
        const raw = (row as { encrypted_value?: unknown }).encrypted_value;
        const bytes = raw instanceof Uint8Array ? raw : new Uint8Array();
        expect(Buffer.from(bytes).toString("utf8").includes(secret)).toBe(false);
      }
    } finally {
      await h.close();
    }
  });

  test("sealed vault fails closed on get and set", async () => {
    const h = await harness();
    try {
      await h.adapter.set("a/b", "v1");
      await h.adapter.seal!();
      await expect(h.adapter.get("a/b")).rejects.toBeInstanceOf(VaultError);
      await expect(h.adapter.set("a/b", "v2")).rejects.toBeInstanceOf(VaultError);
    } finally {
      await h.close();
    }
  });

  test("canonical path is what enters AAD — non-canonical input is rejected before store", () => {
    expect(() => canonicalizePath("../etc/passwd")).toThrow(VaultError);
    expect(() => canonicalizePath("a\\b")).toThrow(VaultError);
    expect(() => canonicalizePath("a\0b")).toThrow(VaultError);
    expect(canonicalizePath("/prod//api/stripe/")).toBe("prod/api/stripe");
  });

  test("AAD path mismatch fails decrypt even with the correct DEK", async () => {
    const dekBytes = generateDek();
    const dek = await importAesKey(dekBytes);
    const aad = buildAad("prod/api/stripe", 1, ALGORITHM, 1);
    const sealed = await encryptSecret(dek, "plain", aad);
    const wrongAad = buildAad("prod/api/other", 1, ALGORITHM, 1);
    await expect(decryptSecret(dek, sealed, wrongAad)).rejects.toBeInstanceOf(VaultError);
  });

  test("VaultError from unwrap paths never exposes a cause chain", async () => {
    const unsealer = createMemoryUnsealer(crypto.getRandomValues(new Uint8Array(32)));
    const kek = await unsealer.unwrapKek();
    const dekBytes = generateDek();
    const aad = buildAad("p", 1, ALGORITHM, 1);
    const wrapped = await wrapDek(kek, dekBytes, aad);
    const other = createMemoryUnsealer(crypto.getRandomValues(new Uint8Array(32)));
    const otherKek = await other.unwrapKek();
    try {
      await unwrapDek(otherKek, wrapped, aad);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(VaultError);
      expect((err as Error & { cause?: unknown }).cause).toBeUndefined();
      expect(String(err)).not.toContain(Buffer.from(dekBytes).toString("base64"));
    }
    unsealer.seal();
    other.seal();
  });

  test("audit verify detects a tampered row_hash", async () => {
    const h = await harness();
    try {
      await h.adapter.set("x/y", "one");
      await h.conn.exec(
        "update oke_vault_audit set row_hash = $1 where seq = (select max(seq) from oke_vault_audit)",
        ["0".repeat(64)],
      );
      const result = await h.adapter.verifyAudit();
      expect(result.ok).toBe(false);
    } finally {
      await h.close();
    }
  });
});
