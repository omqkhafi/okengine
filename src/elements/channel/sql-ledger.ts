/**
 * Postgres-backed consent, suppression, and receipt ledger.
 *
 * Reads are synchronous against a cache. Writes hit SQL and the cache.
 * Call {@link PostgresChannelLedger.reload} on another instance to see them.
 */

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

/** Shared channel ledger (consent + suppression + receipts). */
export interface PostgresChannelLedger {
  readonly consent: ConsentStore;
  readonly suppression: SuppressionStore;
  readonly receipts: ReceiptLedger;
  /** Wait for queued writes. */
  flush(): Promise<void>;
  /** Wait for queued writes, then replace the cache from SQL. */
  reload(): Promise<void>;
}

const CONSENT = "oke_channel_consent";
const BOUNCE = "oke_channel_bounce";
const RECEIPT = "oke_channel_receipt";

/**
 * Open the ledger tables and load the current rows.
 *
 * @param sql - App SQL client
 */
export async function openPostgresChannelLedger(
  sql: ChannelLedgerSql,
): Promise<PostgresChannelLedger> {
  await sql.exec(
    `CREATE TABLE IF NOT EXISTS ${CONSENT} (subject TEXT NOT NULL, medium TEXT NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (subject, medium))`,
  );
  await sql.exec(
    `CREATE TABLE IF NOT EXISTS ${BOUNCE} (subject TEXT NOT NULL, medium TEXT NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (subject, medium))`,
  );
  await sql.exec(`CREATE TABLE IF NOT EXISTS ${RECEIPT} (id TEXT PRIMARY KEY, body TEXT NOT NULL)`);

  const consents: OptOut[] = [];
  const bounces: OptOut[] = [];
  const receipts: DeliveryReceipt[] = [];
  let chain: Promise<void> = Promise.resolve();

  function enqueue(work: () => Promise<void>): void {
    chain = chain.then(work);
  }

  async function flush(): Promise<void> {
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

  const receiptLedger: ReceiptLedger = {
    record(receipt) {
      receipts.push(receipt);
      enqueue(() =>
        sql
          .exec(`INSERT INTO ${RECEIPT} (id, body) VALUES (?, ?)`, [
            receipt.id,
            JSON.stringify(receipt),
          ])
          .then(() => undefined),
      );
    },
    all() {
      return [...receipts];
    },
    forTemplate(template) {
      return receipts.filter((row) => row.template === template);
    },
    byMessageId(messageId) {
      for (let i = receipts.length - 1; i >= 0; i--) {
        const row = receipts[i]!;
        if (row.messageId === messageId || row.id === messageId) return row;
      }
      return undefined;
    },
    updateStatus(messageId, patch) {
      const idx = receipts.findIndex((row) => row.messageId === messageId || row.id === messageId);
      if (idx < 0) return undefined;
      const prev = receipts[idx]!;
      const next: DeliveryReceipt = {
        ...prev,
        status: patch.status,
        at: patch.at ?? prev.at,
        ...(patch.error !== undefined ? { error: patch.error } : {}),
      };
      receipts[idx] = next;
      enqueue(() =>
        sql
          .exec(`UPDATE ${RECEIPT} SET body = ? WHERE id = ?`, [JSON.stringify(next), next.id])
          .then(() => undefined),
      );
      return next;
    },
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

  async function reload(): Promise<void> {
    await flush();
    await loadOptOuts(CONSENT, consents);
    await loadOptOuts(BOUNCE, bounces);
    const rows = await sql.query(`SELECT id, body FROM ${RECEIPT}`);
    receipts.length = 0;
    for (const row of rows) {
      const parsed: unknown = JSON.parse(String(row.body));
      if (parsed && typeof parsed === "object") receipts.push(parsed as DeliveryReceipt);
    }
  }

  await reload();

  return { consent, suppression, receipts: receiptLedger, flush, reload };
}
