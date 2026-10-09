import { describe, expect, test } from "bun:test";

import { openPostgresChannelLedger } from "../elements/channel/sql-ledger.ts";
import { createPostgresJournalFake, createPostgresJournalStore } from "./journal-postgres.ts";
import { createPostgresInstanceStore, type PostgresInstanceSql } from "./instances-postgres.ts";
import { isDuplicateRelation, PG_DDL_LOCK } from "./pg-ddl.ts";
import type { PostgresJournalSql } from "./journal-postgres.ts";

describe("postgres relation create", () => {
  test("journal schema locks each relation inside the create transaction", async () => {
    const fake = createPostgresJournalFake();
    const seen: string[] = [];
    const sql: PostgresJournalSql = {
      query: (statement, params) => fake.query(statement, params),
      exec: (statement, params) => fake.exec(statement, params),
      close: () => fake.close(),
      begin: (fn) =>
        fake.begin(async (tx) =>
          fn({
            query: (statement, params) => tx.query(statement, params),
            exec: async (statement, params) => {
              seen.push(statement.trim());
              return tx.exec(statement, params);
            },
            close: () => tx.close(),
            begin: (inner) => tx.begin(inner),
          }),
        ),
    };
    const store = await createPostgresJournalStore({ sql });
    const lock = seen.findIndex((statement) =>
      statement.includes(`pg_advisory_xact_lock(${PG_DDL_LOCK.journalRuns})`),
    );
    const create = seen.findIndex((statement) =>
      statement.startsWith("CREATE TABLE IF NOT EXISTS oke_journal_runs"),
    );
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThan(lock);
    expect(
      seen.some((statement) =>
        statement.includes(`pg_advisory_xact_lock(${PG_DDL_LOCK.idempotencyExpires})`),
      ),
    ).toBe(true);
    await store.close();
  });

  test("23505 and 42P07 do not fail a create, and another code does", async () => {
    expect(isDuplicateRelation(Object.assign(new Error("dup"), { code: "23505" }))).toBe(true);
    expect(isDuplicateRelation(Object.assign(new Error("exists"), { errno: "42P07" }))).toBe(true);
    expect(
      isDuplicateRelation(Object.assign(new Error("wrapped"), { cause: { code: "23505" } })),
    ).toBe(true);
    expect(isDuplicateRelation(Object.assign(new Error("syntax"), { code: "42601" }))).toBe(false);

    let creates = 0;
    const duplicate: PostgresInstanceSql = {
      async query() {
        return [];
      },
      async exec(statement) {
        if (/^CREATE/i.test(statement)) {
          const code = creates === 0 ? "23505" : "42P07";
          creates += 1;
          throw Object.assign(new Error(`duplicate ${code}`), { code });
        }
        return { changes: 0 };
      },
      async close() {},
    };
    const store = await createPostgresInstanceStore({ sql: duplicate });
    expect(creates).toBe(2);
    await store.close?.();

    const syntax: PostgresInstanceSql = {
      async query() {
        return [];
      },
      async exec() {
        throw Object.assign(new Error("syntax"), { code: "42601" });
      },
      async close() {},
    };
    await expect(createPostgresInstanceStore({ sql: syntax })).rejects.toThrow(/syntax/);
  });

  test("a channel ledger create treats a duplicate relation as success", async () => {
    const statements: string[] = [];
    const ledger = await openPostgresChannelLedger({
      async query() {
        return [];
      },
      async exec(statement) {
        statements.push(statement);
        if (/^CREATE/i.test(statement)) {
          throw Object.assign(new Error("duplicate"), { code: "42P07" });
        }
        return { changes: 0 };
      },
    });
    expect(statements.some((statement) => statement.includes("CREATE TABLE"))).toBe(true);
    await ledger.flush();
  });
});
