/**
 * Postgres channel ledger — incremental receipt reload and cache-miss lookup.
 */

import { describe, expect, test } from "bun:test";
import { asChannelSql } from "../../kernel/boot-bind/channel.ts";
import { sharedPostgresClient } from "../../drivers/postgres.ts";
import type { DeliveryReceipt } from "./receipts.ts";
import { createChannelRuntime } from "./runtime.ts";
import { openPostgresChannelLedger, type ChannelLedgerSql } from "./sql-ledger.ts";

const LIVE_URL =
  process.env.OKE_TEST_POSTGRES_URL?.trim() ||
  (process.env.OKE_TEST_POSTGRES === "1"
    ? (process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL)?.trim()
    : undefined);

interface StoredReceipt {
  readonly id: string;
  readonly body: string;
  readonly message_id: string | null;
  readonly updated_at: number;
}

interface LedgerSqlFake extends ChannelLedgerSql {
  /**
   * Set the fake database clock in milliseconds.
   *
   * @param ms - `clock_timestamp()` milliseconds
   */
  setNow(ms: number): void;
  /**
   * Insert a row without going through the ledger.
   *
   * @param row - Stored receipt
   */
  seedReceipt(row: StoredReceipt): void;
  /**
   * Pause the next incremental receipt read.
   *
   * @param gate - Resolves when the read may finish
   */
  holdNextDelta(gate: Promise<void>): void;
  /** Incremental receipt reads so far. */
  deltaReads(): number;
  /** Point lookups so far. */
  lookupReads(): number;
  /**
   * Read one stored row.
   *
   * @param id - Receipt id
   */
  receipt(id: string): StoredReceipt | undefined;
}

function receipt(
  overrides: Partial<DeliveryReceipt> & Pick<DeliveryReceipt, "id">,
): DeliveryReceipt {
  return {
    template: "note",
    to: "a@b.c",
    medium: "email",
    status: "sent",
    attempts: [],
    at: 1,
    ...overrides,
  };
}

/**
 * In-memory Postgres stand-in. Patterns are ordered so a specific statement
 * wins over a broader one. Anything else throws.
 */
function ledgerSqlFake(): LedgerSqlFake {
  let nowMs = 0;
  let deltaReadCount = 0;
  let lookupReadCount = 0;
  let nextDeltaHold: Promise<void> | undefined;
  const consent = new Map<string, { subject: string; medium: string; at: number }>();
  const bounce = new Map<string, { subject: string; medium: string; at: number }>();
  const receipts = new Map<string, StoredReceipt>();

  function sqlText(value: unknown): string {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
      return String(value);
    }
    throw new Error(`expected a SQL text binding, got ${typeof value}`);
  }

  function pair(params: readonly unknown[]): string {
    return `${sqlText(params[0])}\0${sqlText(params[1])}`;
  }

  const execHandlers: ReadonlyArray<{
    readonly pattern: RegExp;
    readonly run: (params: readonly unknown[]) => { changes: number };
  }> = [
    { pattern: /ADD COLUMN IF NOT EXISTS updated_at/, run: () => ({ changes: 0 }) },
    { pattern: /ADD COLUMN IF NOT EXISTS message_id/, run: () => ({ changes: 0 }) },
    {
      pattern: /CREATE INDEX IF NOT EXISTS oke_channel_receipt_message_id_idx/,
      run: () => ({ changes: 0 }),
    },
    {
      pattern: /CREATE INDEX IF NOT EXISTS oke_channel_receipt_updated_at_idx/,
      run: () => ({ changes: 0 }),
    },
    { pattern: /^CREATE TABLE/, run: () => ({ changes: 0 }) },
    {
      pattern: /INSERT INTO oke_channel_consent/,
      run: (params) => {
        consent.set(pair(params), {
          subject: sqlText(params[0]),
          medium: sqlText(params[1]),
          at: Number(params[2]),
        });
        return { changes: 1 };
      },
    },
    {
      pattern: /DELETE FROM oke_channel_consent/,
      run: (params) => {
        consent.delete(pair(params));
        return { changes: 1 };
      },
    },
    {
      pattern: /INSERT INTO oke_channel_bounce/,
      run: (params) => {
        bounce.set(pair(params), {
          subject: sqlText(params[0]),
          medium: sqlText(params[1]),
          at: Number(params[2]),
        });
        return { changes: 1 };
      },
    },
    {
      pattern: /DELETE FROM oke_channel_bounce/,
      run: (params) => {
        bounce.delete(pair(params));
        return { changes: 1 };
      },
    },
    {
      pattern: /UPDATE oke_channel_receipt SET message_id/,
      run: (params) => {
        const id = sqlText(params[1]);
        const prev = receipts.get(id);
        if (!prev || prev.message_id != null) return { changes: 0 };
        receipts.set(id, { ...prev, message_id: sqlText(params[0]) });
        return { changes: 1 };
      },
    },
    {
      pattern: /INSERT INTO oke_channel_receipt/,
      run: (params) => {
        const id = sqlText(params[0]);
        receipts.set(id, {
          id,
          body: sqlText(params[1]),
          message_id: params[2] == null ? null : sqlText(params[2]),
          updated_at: nowMs,
        });
        return { changes: 1 };
      },
    },
    {
      pattern: /UPDATE oke_channel_receipt/,
      run: (params) => {
        const id = sqlText(params[2]);
        const prev = receipts.get(id);
        if (!prev) return { changes: 0 };
        receipts.set(id, {
          id,
          body: sqlText(params[0]),
          message_id: params[1] == null ? null : sqlText(params[1]),
          updated_at: nowMs,
        });
        return { changes: 1 };
      },
    },
  ];

  const queryHandlers: ReadonlyArray<{
    readonly pattern: RegExp;
    readonly run: (params: readonly unknown[]) => Promise<Record<string, unknown>[]>;
  }> = [
    {
      pattern: /WHERE message_id IS NULL/,
      run: () =>
        Promise.resolve(
          [...receipts.values()]
            .filter((row) => row.message_id == null)
            .map((row) => ({ id: row.id, body: row.body })),
        ),
    },
    {
      pattern: /WHERE id = \? OR message_id = \?/,
      run: (params) => {
        lookupReadCount += 1;
        const key = sqlText(params[0]);
        const found = [...receipts.values()].find(
          (row) => row.id === key || row.message_id === key,
        );
        if (!found) return Promise.resolve([]);
        return Promise.resolve([
          {
            id: found.id,
            body: found.body,
            message_id: found.message_id,
            updated_at: found.updated_at,
          },
        ]);
      },
    },
    {
      pattern: /oke_channel_receipt/,
      run: async (params) => {
        deltaReadCount += 1;
        const hold = nextDeltaHold;
        nextDeltaHold = undefined;
        if (hold) await hold;
        const since = Number(params[0]);
        const matched = [...receipts.values()].filter((row) => row.updated_at >= since);
        if (matched.length === 0) return [{ db_now: nowMs }];
        return matched.map((row) => ({
          id: row.id,
          body: row.body,
          message_id: row.message_id,
          updated_at: row.updated_at,
          db_now: nowMs,
        }));
      },
    },
    {
      pattern: /oke_channel_consent/,
      run: () => Promise.resolve([...consent.values()]),
    },
    {
      pattern: /oke_channel_bounce/,
      run: () => Promise.resolve([...bounce.values()]),
    },
  ];

  function match<T>(
    sql: string,
    handlers: ReadonlyArray<{
      readonly pattern: RegExp;
      readonly run: (params: readonly unknown[]) => T;
    }>,
    params: readonly unknown[],
  ): T {
    for (const handler of handlers) {
      if (handler.pattern.test(sql)) return handler.run(params);
    }
    throw new Error(`unknown SQL: ${sql}`);
  }

  return {
    async query(sql, params = []) {
      return match(sql, queryHandlers, params);
    },
    async exec(sql, params = []) {
      return match(sql, execHandlers, params);
    },
    setNow(ms) {
      nowMs = ms;
    },
    seedReceipt(row) {
      receipts.set(row.id, row);
    },
    holdNextDelta(gate) {
      nextDeltaHold = gate;
    },
    deltaReads() {
      return deltaReadCount;
    },
    lookupReads() {
      return lookupReadCount;
    },
    receipt(id) {
      return receipts.get(id);
    },
  };
}

describe("postgres channel receipt ledger", () => {
  test("unknown SQL throws", async () => {
    const sql = ledgerSqlFake();
    await expect(sql.query("SELECT 1")).rejects.toThrow(/unknown SQL/);
    await expect(sql.exec("DROP TABLE oke_channel_receipt")).rejects.toThrow(/unknown SQL/);
  });

  test("incremental reload keeps a receipt that was not in the delta", async () => {
    const sql = ledgerSqlFake();
    sql.seedReceipt({
      id: "keep",
      body: JSON.stringify(receipt({ id: "keep", messageId: "keep-m" })),
      message_id: "keep-m",
      updated_at: 0,
    });
    sql.setNow(100_000);
    const ledger = await openPostgresChannelLedger(sql);
    expect(ledger.receipts.byMessageId("keep-m")?.id).toBe("keep");

    sql.setNow(200_000);
    sql.seedReceipt({
      id: "keep",
      body: JSON.stringify(receipt({ id: "keep", messageId: "keep-m", template: "rewritten" })),
      message_id: "keep-m",
      updated_at: 0,
    });
    await ledger.reload();

    expect(ledger.receipts.byMessageId("keep-m")?.template).toBe("note");
    expect(ledger.receipts.all().map((row) => row.id)).toEqual(["keep"]);
  });

  test("a status update reloads onto a second ledger without clearing", async () => {
    const sql = ledgerSqlFake();
    sql.seedReceipt({
      id: "keep",
      body: JSON.stringify(receipt({ id: "keep", messageId: "keep-m" })),
      message_id: "keep-m",
      updated_at: 0,
    });
    sql.setNow(100_000);
    const writer = await openPostgresChannelLedger(sql);
    const reader = await openPostgresChannelLedger(sql);
    writer.receipts.record(receipt({ id: "r1", messageId: "m1", status: "sent" }));
    await writer.flush();
    expect(writer.receipts.updateStatus("m1", { status: "hard-bounce", at: 5 })?.status).toBe(
      "hard-bounce",
    );
    await writer.flush();

    sql.setNow(200_000);
    sql.seedReceipt({
      id: "keep",
      body: JSON.stringify(receipt({ id: "keep", messageId: "keep-m", template: "rewritten" })),
      message_id: "keep-m",
      updated_at: 0,
    });
    await reader.reload();

    expect(reader.receipts.byMessageId("keep-m")?.template).toBe("note");
    expect(reader.receipts.byMessageId("m1")?.status).toBe("hard-bounce");
    expect(reader.receipts.all()).toHaveLength(2);
  });

  test("a message id miss loads the row instead of synthesizing", async () => {
    const sql = ledgerSqlFake();
    sql.setNow(1_000);
    const writer = await openPostgresChannelLedger(sql);
    const reader = await openPostgresChannelLedger(sql);
    writer.receipts.record(
      receipt({ id: "r1", messageId: "provider-1", template: "note", to: "a@b.c" }),
    );
    await writer.flush();
    expect(reader.receipts.byMessageId("provider-1")).toBeUndefined();

    const runtime = createChannelRuntime({
      receipts: reader.receipts,
      suppression: reader.suppression,
    });
    const result = await runtime.ingestOutcome({
      messageId: "provider-1",
      state: "hard-bounce",
      medium: "email",
    });

    expect(sql.lookupReads()).toBe(1);
    expect(result.id).toBe("r1");
    expect(result.template).toBe("note");
    expect(result.status).toBe("hard-bounce");
    await reader.flush();
    const stored = JSON.parse(sql.receipt("r1")?.body ?? "{}") as DeliveryReceipt;
    expect(stored.status).toBe("hard-bounce");
    expect(reader.receipts.all()).toHaveLength(1);
  });

  test("updateStatus on a cache miss writes the stored body", async () => {
    const sql = ledgerSqlFake();
    const writer = await openPostgresChannelLedger(sql);
    const reader = await openPostgresChannelLedger(sql);
    writer.receipts.record(receipt({ id: "r1", messageId: "m1", status: "sent" }));
    await writer.flush();
    expect(reader.receipts.byMessageId("m1")).toBeUndefined();
    expect(reader.receipts.updateStatus("m1", { status: "hard-bounce", at: 9 })).toBeUndefined();
    await reader.flush();
    const stored = JSON.parse(sql.receipt("r1")?.body ?? "{}") as DeliveryReceipt;
    expect(stored.status).toBe("hard-bounce");
    expect(stored.at).toBe(9);
    expect(reader.receipts.byMessageId("m1")?.status).toBe("hard-bounce");
    expect(reader.receipts.all()).toHaveLength(1);
  });

  test("legacy updated_at 0 rows are included on the first reload", async () => {
    const sql = ledgerSqlFake();
    const legacy = receipt({ id: "legacy", messageId: "leg-1", template: "note" });
    sql.seedReceipt({
      id: "legacy",
      body: JSON.stringify(legacy),
      message_id: null,
      updated_at: 0,
    });
    sql.setNow(5_000);
    const ledger = await openPostgresChannelLedger(sql);

    expect(ledger.receipts.byMessageId("leg-1")?.id).toBe("legacy");
    expect(sql.receipt("legacy")?.message_id).toBe("leg-1");
  });

  test("a second reload waits for the in-flight read", async () => {
    const sql = ledgerSqlFake();
    const ledger = await openPostgresChannelLedger(sql);
    const before = sql.deltaReads();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    sql.holdNextDelta(gate);
    const first = ledger.reload();
    const second = ledger.reload();
    release();
    await Promise.all([first, second]);
    expect(sql.deltaReads()).toBe(before + 1);
  });
});

describe.skipIf(!LIVE_URL)("channel ledger — two postgres connections", () => {
  test("a ledger that has not reloaded still updates the stored receipt", async () => {
    const sql = asChannelSql(sharedPostgresClient(LIVE_URL!));
    const writer = await openPostgresChannelLedger(sql);
    const reader = await openPostgresChannelLedger(sql);
    const id = `r-${crypto.randomUUID()}`;
    const messageId = `m-${crypto.randomUUID()}`;
    const directId = `r-${crypto.randomUUID()}`;
    const directMessage = `m-${crypto.randomUUID()}`;
    try {
      writer.receipts.record(
        receipt({ id, messageId, status: "sent", template: "note", to: "a@b.c" }),
      );
      writer.receipts.record(
        receipt({ id: directId, messageId: directMessage, status: "sent", template: "note" }),
      );
      await writer.flush();
      expect(reader.receipts.byMessageId(messageId)).toBeUndefined();

      const runtime = createChannelRuntime({
        receipts: reader.receipts,
        suppression: reader.suppression,
      });
      const result = await runtime.ingestOutcome({
        messageId,
        state: "hard-bounce",
        medium: "email",
      });
      expect(result.id).toBe(id);
      expect(result.status).toBe("hard-bounce");
      expect(
        reader.receipts.updateStatus(directMessage, { status: "fallback", at: 4 }),
      ).toBeUndefined();
      await reader.flush();

      const rows = await sql.query(
        `SELECT id, body FROM oke_channel_receipt WHERE id = ? OR id = ?`,
        [id, directId],
      );
      const byId = new Map(
        rows.map((row) => {
          const body = JSON.parse(String(row.body)) as DeliveryReceipt;
          return [String(row.id), body] as const;
        }),
      );
      expect(byId.get(id)?.status).toBe("hard-bounce");
      expect(byId.get(directId)?.status).toBe("fallback");
      expect(reader.receipts.byMessageId(directMessage)?.status).toBe("fallback");
    } finally {
      await sql.exec(`DELETE FROM oke_channel_receipt WHERE id = ? OR id = ?`, [id, directId]);
    }
  });
});

if (!LIVE_URL) {
  test("skip: channel ledger live postgres (set OKE_TEST_POSTGRES_URL or OKE_TEST_POSTGRES=1 + DATABASE_URL)", () => {
    expect(LIVE_URL).toBeUndefined();
  });
}
