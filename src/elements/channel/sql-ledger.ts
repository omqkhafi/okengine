/**
 * Postgres-backed consent, suppression, and receipt ledger.
 *
 * Reads are synchronous against a cache. Writes hit SQL and the cache.
 * Call {@link PostgresChannelLedger.reload} on another instance to see them.
 * Receipt reloads merge rows touched since the last read and keep the rest.
 */

import { execIfNotExists } from "../../drivers/pg-ddl.ts";
import type { ChannelMedium } from "../../manifest/types.ts";
import type { ConsentStore, OptOut } from "./consent.ts";
import type { DeliveryReceipt, ReceiptLedger } from "./receipts.ts";
import type { SuppressionEntry, SuppressionReason, SuppressionStore } from "./suppression.ts";

/** SQL surface the channel ledger needs (`?` placeholders). */
export interface ChannelLedgerSql {
  /**
   * Run a query and return rows.
   *
   * @param sql - Statement
   * @param params - Bindings
   */
  query(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
  /**
   * Run a statement.
   *
   * @param sql - Statement
   * @param params - Bindings
   */
  exec(sql: string, params?: readonly unknown[]): Promise<{ changes: number }>;
}

/**
 * Durable receipt read used when the in-memory cache misses.
 */
export interface ChannelReceiptLookup {
  /**
   * Load one receipt by receipt id or provider message id.
   *
   * @param messageId - Receipt id or provider message id
   */
  lookup(messageId: string): Promise<DeliveryReceipt | undefined>;
}

/** Shared channel ledger (consent + suppression + receipts). */
export interface PostgresChannelLedger {
  readonly consent: ConsentStore;
  readonly suppression: SuppressionStore;
  readonly receipts: ReceiptLedger & ChannelReceiptLookup;
  /** Wait for queued writes. */
  flush(): Promise<void>;
  /**
   * Wait for queued writes, then refresh the cache from SQL.
   * Receipts merge by id. Rows absent from the delta stay cached.
   */
  reload(): Promise<void>;
}

const CONSENT = "oke_channel_consent";
const BOUNCE = "oke_channel_bounce";
const RECEIPT = "oke_channel_receipt";
/** Postgres `clock_timestamp()` in milliseconds. Writes use the database clock. */
const DB_NOW_MS = "(extract(epoch from clock_timestamp())*1000)::bigint";
/**
 * Reload overlap. A commit that lands while a read is in flight still
 * appears on the next pass because the cursor moves backward by this much.
 */
const RECEIPT_RELOAD_LAG_MS = 30_000;

/**
 * Open the ledger tables and load the current rows.
 *
 * @param sql - App SQL client
 */
export async function openPostgresChannelLedger(
  sql: ChannelLedgerSql,
): Promise<PostgresChannelLedger> {
  await execIfNotExists(
    sql,
    `CREATE TABLE IF NOT EXISTS ${CONSENT} (subject TEXT NOT NULL, medium TEXT NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (subject, medium))`,
  );
  await execIfNotExists(
    sql,
    `CREATE TABLE IF NOT EXISTS ${BOUNCE} (subject TEXT NOT NULL, medium TEXT NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (subject, medium))`,
  );
  await execIfNotExists(
    sql,
    `CREATE TABLE IF NOT EXISTS ${RECEIPT} (id TEXT PRIMARY KEY, body TEXT NOT NULL)`,
  );
  await sql.exec(
    `ALTER TABLE ${RECEIPT} ADD COLUMN IF NOT EXISTS updated_at BIGINT NOT NULL DEFAULT 0`,
  );
  await sql.exec(`ALTER TABLE ${RECEIPT} ADD COLUMN IF NOT EXISTS message_id TEXT`);
  await execIfNotExists(
    sql,
    `CREATE INDEX IF NOT EXISTS oke_channel_receipt_message_id_idx ON ${RECEIPT} (message_id)`,
  );
  await execIfNotExists(
    sql,
    `CREATE INDEX IF NOT EXISTS oke_channel_receipt_updated_at_idx ON ${RECEIPT} (updated_at)`,
  );

  const consents: OptOut[] = [];
  const bounces: OptOut[] = [];
  let chain: Promise<void> = Promise.resolve();

  function enqueue(work: () => Promise<void>): void {
    chain = chain.then(work, work);
  }

  async function drain(): Promise<void> {
    await chain;
  }

  function matches(rows: readonly OptOut[], subject: string, medium: ChannelMedium): boolean {
    return rows.some(
      (row) => row.subject === subject && (row.medium === "all" || row.medium === medium),
    );
  }

  function remember(
    rows: OptOut[],
    subject: string,
    medium: ChannelMedium | "all",
    at: number,
  ): void {
    const idx = rows.findIndex((row) => row.subject === subject && row.medium === medium);
    const next: OptOut = { subject, medium, at };
    if (idx >= 0) rows[idx] = next;
    else rows.push(next);
  }

  function forget(rows: OptOut[], subject: string, medium: ChannelMedium | "all"): void {
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i]!;
      if (row.subject === subject && row.medium === medium) rows.splice(i, 1);
    }
  }

  const consent: ConsentStore = {
    isOptedOut(subject, medium) {
      return matches(consents, subject, medium);
    },
    optOut(subject, medium) {
      const at = Date.now();
      remember(consents, subject, medium, at);
      enqueue(() =>
        sql
          .exec(
            `INSERT INTO ${CONSENT} (subject, medium, at) VALUES (?, ?, ?) ON CONFLICT (subject, medium) DO UPDATE SET at = excluded.at`,
            [subject, medium, at],
          )
          .then(() => undefined),
      );
    },
    optIn(subject, medium) {
      forget(consents, subject, medium);
      enqueue(() =>
        sql
          .exec(`DELETE FROM ${CONSENT} WHERE subject = ? AND medium = ?`, [subject, medium])
          .then(() => undefined),
      );
    },
    list() {
      return [...consents];
    },
  };

  function reasonFor(
    subject: string,
    medium: ChannelMedium,
  ):
    | { readonly suppressed: true; readonly reason: SuppressionReason }
    | { readonly suppressed: false } {
    if (consent.isOptedOut(subject, medium)) return { suppressed: true, reason: "opted-out" };
    if (matches(bounces, subject, medium)) return { suppressed: true, reason: "prior-bounce" };
    return { suppressed: false };
  }

  const suppression: SuppressionStore = {
    consent,
    isSuppressed: reasonFor,
    optOut(subject, medium) {
      consent.optOut(subject, medium);
    },
    addPriorBounce(subject, medium) {
      const at = Date.now();
      remember(bounces, subject, medium, at);
      enqueue(() =>
        sql
          .exec(
            `INSERT INTO ${BOUNCE} (subject, medium, at) VALUES (?, ?, ?) ON CONFLICT (subject, medium) DO UPDATE SET at = excluded.at`,
            [subject, medium, at],
          )
          .then(() => undefined),
      );
    },
    clear(subject, medium) {
      consent.optIn(subject, medium);
      forget(bounces, subject, medium);
      enqueue(() =>
        sql
          .exec(`DELETE FROM ${BOUNCE} WHERE subject = ? AND medium = ?`, [subject, medium])
          .then(() => undefined),
      );
    },
    list() {
      const rows: SuppressionEntry[] = [];
      for (const row of consents) {
        rows.push({ subject: row.subject, medium: row.medium, reason: "opted-out", at: row.at });
      }
      for (const row of bounces) {
        rows.push({ subject: row.subject, medium: row.medium, reason: "prior-bounce", at: row.at });
      }
      return rows;
    },
  };

  const byId = new Map<string, DeliveryReceipt>();
  const byMessage = new Map<string, string>();
  /** `updated_at` cursor. Starts at 0 so legacy rows (`updated_at = 0`) load. */
  let cursor = 0;
  let reloading: Promise<void> | undefined;
  let messageIdBackfill: Promise<void> | undefined;

  function rememberReceipt(receipt: DeliveryReceipt): void {
    const prev = byId.get(receipt.id);
    if (prev?.messageId && prev.messageId !== receipt.messageId) {
      if (byMessage.get(prev.messageId) === receipt.id) byMessage.delete(prev.messageId);
    }
    byId.set(receipt.id, receipt);
    byMessage.set(receipt.id, receipt.id);
    if (receipt.messageId) byMessage.set(receipt.messageId, receipt.id);
  }

  function applyStatus(
    prev: DeliveryReceipt,
    patch: {
      readonly status: DeliveryReceipt["status"];
      readonly at?: number;
      readonly error?: string;
    },
  ): DeliveryReceipt {
    return {
      ...prev,
      status: patch.status,
      at: patch.at ?? prev.at,
      ...(patch.error !== undefined ? { error: patch.error } : {}),
    };
  }

  function writeStatus(next: DeliveryReceipt): Promise<void> {
    return sql
      .exec(
        `UPDATE ${RECEIPT} SET body = ?, message_id = ?, updated_at = ${DB_NOW_MS} WHERE id = ?`,
        [JSON.stringify(next), next.messageId ?? null, next.id],
      )
      .then(() => undefined);
  }

  function findByMessageId(messageId: string): DeliveryReceipt | undefined {
    const id = byMessage.get(messageId);
    if (id === undefined) return undefined;
    return byId.get(id);
  }

  function parseReceipt(body: unknown): DeliveryReceipt | undefined {
    let parsed: unknown = body;
    if (typeof body === "string") {
      try {
        parsed = JSON.parse(body);
      } catch {
        return undefined;
      }
    } else if (body === null || typeof body !== "object") {
      return undefined;
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("id" in parsed) ||
      typeof parsed.id !== "string"
    ) {
      return undefined;
    }
    return parsed as DeliveryReceipt;
  }

  function readMillis(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "bigint") return Number(value);
    if (typeof value === "string" && value !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  }

  const receiptLedger = {
    record(receipt: DeliveryReceipt) {
      rememberReceipt(receipt);
      enqueue(() =>
        sql
          .exec(
            `INSERT INTO ${RECEIPT} (id, body, message_id, updated_at) VALUES (?, ?, ?, ${DB_NOW_MS})`,
            [receipt.id, JSON.stringify(receipt), receipt.messageId ?? null],
          )
          .then(() => undefined),
      );
    },
    all() {
      return [...byId.values()];
    },
    forTemplate(template: string) {
      return [...byId.values()].filter((row) => row.template === template);
    },
    byMessageId(messageId: string) {
      return findByMessageId(messageId);
    },
    flush() {
      return drain();
    },
    updateStatus(
      messageId: string,
      patch: {
        readonly status: DeliveryReceipt["status"];
        readonly at?: number;
        readonly error?: string;
      },
    ) {
      const prev = findByMessageId(messageId);
      if (!prev) {
        return (async () => {
          const loaded = await receiptLedger.lookup(messageId);
          if (!loaded) return undefined;
          const next = applyStatus(loaded, patch);
          rememberReceipt(next);
          await writeStatus(next);
          return next;
        })();
      }
      const next = applyStatus(prev, patch);
      rememberReceipt(next);
      enqueue(() => writeStatus(next));
      return next;
    },
    async lookup(messageId: string): Promise<DeliveryReceipt | undefined> {
      const needle = `"messageId":${JSON.stringify(messageId)}`;
      const rows = await sql.query(
        `SELECT id, body, message_id, updated_at FROM ${RECEIPT} WHERE id = ? OR message_id = ? OR position(? in body) > 0 LIMIT 1`,
        [messageId, messageId, needle],
      );
      const row = rows[0];
      if (!row) return undefined;
      const receipt = parseReceipt(row.body);
      if (!receipt) return undefined;
      rememberReceipt(receipt);
      return receipt;
    },
  } satisfies ReceiptLedger &
    ChannelReceiptLookup & {
      /** Drain queued receipt writes. The channel runtime awaits this after a status change. */
      flush(): Promise<void>;
    };

  async function loadOptOuts(table: string, into: OptOut[]): Promise<void> {
    const rows = await sql.query(`SELECT subject, medium, at FROM ${table}`);
    into.length = 0;
    for (const row of rows) {
      into.push({
        subject: String(row.subject),
        medium: String(row.medium) as ChannelMedium | "all",
        at: Number(row.at),
      });
    }
  }

  function backfillMessageIds(): Promise<void> {
    if (messageIdBackfill) return messageIdBackfill;
    const run = (async () => {
      const rows = await sql.query(`SELECT id, body FROM ${RECEIPT} WHERE message_id IS NULL`);
      for (const row of rows) {
        const receipt = parseReceipt(row.body);
        const messageId = receipt?.messageId;
        if (!messageId) continue;
        await sql.exec(`UPDATE ${RECEIPT} SET message_id = ? WHERE id = ? AND message_id IS NULL`, [
          messageId,
          String(row.id),
        ]);
      }
    })().catch((err: unknown) => {
      messageIdBackfill = undefined;
      throw err;
    });
    messageIdBackfill = run;
    return run;
  }

  async function loadReceiptDelta(): Promise<void> {
    const since = cursor - RECEIPT_RELOAD_LAG_MS;
    const rows = await sql.query(
      `SELECT r.id, r.body, r.message_id, r.updated_at, now_ms.db_now FROM (SELECT ${DB_NOW_MS} AS db_now) AS now_ms LEFT JOIN ${RECEIPT} r ON r.updated_at >= ?`,
      [since],
    );
    let dbNow: number | undefined;
    for (const row of rows) {
      const read = readMillis(row.db_now);
      if (read !== undefined) dbNow = read;
      if (row.id == null || row.body == null) continue;
      const receipt = parseReceipt(row.body);
      if (receipt) rememberReceipt(receipt);
    }
    if (dbNow !== undefined) cursor = dbNow;
  }

  async function reloadFromSql(): Promise<void> {
    await drain();
    await loadOptOuts(CONSENT, consents);
    await loadOptOuts(BOUNCE, bounces);
    await backfillMessageIds();
    await loadReceiptDelta();
  }

  function reload(): Promise<void> {
    if (reloading) return reloading;
    const run = reloadFromSql().finally(() => {
      if (reloading === run) reloading = undefined;
    });
    reloading = run;
    return run;
  }

  await reload();

  return { consent, suppression, receipts: receiptLedger, flush: drain, reload };
}
