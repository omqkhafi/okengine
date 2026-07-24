/**
 * Runs runtime — append wide events from flow executions, query, erase.
 */

import { collectWideEvent, type CollectWideEventInput } from "./collect.ts";
import { clickhouseRunsDriver } from "./drivers/clickhouse.ts";
import { filesRunsDriver } from "./drivers/files.ts";
import { memoryRunsDriver } from "./drivers/memory.ts";
import { postgresRunsDriver } from "./drivers/postgres.ts";
import {
  explainOutliers,
  type ExplainOutliersOptions,
  type OutlierFinding,
} from "./outlier.ts";
import {
  archiveFields,
  eraseSubject,
  revealArchived,
  type SubjectKeyVault,
} from "./shred.ts";
import type {
  RunsDriver,
  RunsDriverId,
  RunsOpenOptions,
  RunsRow,
  RunsStore,
  WideEvent,
} from "./types.ts";

/** Options for {@link createRunsRuntime}. */
export interface CreateRunsRuntimeOptions extends RunsOpenOptions {
  /**
   * Driver id or instance. Default: `files` (Parquet + DuckDB).
   * Config example uses `memory` under `test`.
   */
  readonly driver?: RunsDriverId | RunsDriver;
  /** Subject-key vault for crypto-shredding. */
  readonly subjectKeys?: SubjectKeyVault;
  /** Build version stamped on collected events. */
  readonly buildVersion?: string;
}

/** Runs runtime surface. */
export interface RunsRuntime {
  /** Underlying store (after {@link open}). */
  readonly store: RunsStore | undefined;
  /** Open the configured driver. */
  open(): Promise<RunsStore>;
  /**
   * Collect + optionally archive PII + append one execution.
   *
   * @param input - Collect input (ledger, telemetry, flow, …)
   * @param archiveCleartext - Personal fields to crypto-shred
   */
  record(
    input: CollectWideEventInput,
    archiveCleartext?: Readonly<Record<string, string>>,
  ): Promise<WideEvent>;
  /**
   * Append a fully-built wide event.
   *
   * @param event - Wide event
   */
  append(event: WideEvent): Promise<void>;
  /** Flush buffers. */
  flush(): Promise<void>;
  /**
   * Query across all partitions.
   *
   * @param sql - SQL (`FROM runs` for files/memory)
   */
  query(sql: string): Promise<RunsRow[]>;
  /** All events (small stores / tests). */
  all(): Promise<WideEvent[]>;
  /**
   * Outlier explanation over stored (or provided) events.
   *
   * @param options - Selection predicate
   * @param events - Optional explicit dataset (defaults to `all()`)
   */
  explain(
    options: ExplainOutliersOptions,
    events?: readonly WideEvent[],
  ): Promise<OutlierFinding[]>;
  /**
   * Reveal archived fields for a subject (or shredded markers).
   *
   * @param subjectId - Subject id
   * @param archived - Ciphertext map
   */
  reveal(
    subjectId: string,
    archived: Readonly<Record<string, string>>,
  ): Promise<Record<string, string>>;
  /**
   * Crypto-shred a subject — deletes the Vault key, not the Parquet bytes.
   *
   * @param subjectId - Subject id
   */
  erase(subjectId: string): boolean;
  /** Close the store. */
  close(): Promise<void>;
}

const DRIVER_BY_ID: Record<RunsDriverId, RunsDriver> = {
  files: filesRunsDriver,
  memory: memoryRunsDriver,
  postgres: postgresRunsDriver,
  clickhouse: clickhouseRunsDriver,
};

/**
 * Resolve a driver id or instance.
 *
 * @param driver - Id or driver
 */
export function resolveRunsDriver(
  driver?: RunsDriverId | RunsDriver,
): RunsDriver {
  if (!driver) return filesRunsDriver;
  if (typeof driver === "string") {
    const d = DRIVER_BY_ID[driver];
    if (!d) throw new Error(`unknown runs driver: ${driver}`);
    return d;
  }
  return driver;
}

/**
 * Create a runs runtime.
 *
 * @param options - Driver + locality + subject keys
 */
export function createRunsRuntime(
  options: CreateRunsRuntimeOptions = {},
): RunsRuntime {
  const driver = resolveRunsDriver(options.driver);
  let store: RunsStore | undefined;
  const subjectKeys = options.subjectKeys;

  async function ensureStore(): Promise<RunsStore> {
    if (!store) {
      store = await driver.open(options);
    }
    return store;
  }

  return {
    get store() {
      return store;
    },
    async open() {
      return ensureStore();
    },
    async record(input, archiveCleartext) {
      const s = await ensureStore();
      let archived = input.archived;
      const subjectId =
        input.telemetry.subjectId ??
        input.fx.auth.userId ??
        input.fx.tenant.id ??
        null;
      if (
        archiveCleartext &&
        subjectId &&
        subjectKeys &&
        Object.keys(archiveCleartext).length > 0
      ) {
        archived = await archiveFields(
          subjectKeys,
          subjectId,
          archiveCleartext,
        );
      }
      const event = collectWideEvent({
        ...input,
        buildVersion: input.buildVersion ?? options.buildVersion,
        ...(archived !== undefined ? { archived } : {}),
      });
      await s.append(event);
      return event;
    },
    async append(event) {
      const s = await ensureStore();
      await s.append(event);
    },
    async flush() {
      const s = await ensureStore();
      await s.flush();
    },
    async query(sql) {
      const s = await ensureStore();
      return s.query(sql);
    },
    async all() {
      const s = await ensureStore();
      return s.all();
    },
    async explain(explainOptions, events) {
      const dataset = events ?? (await this.all());
      return explainOutliers(dataset, explainOptions);
    },
    async reveal(subjectId, archived) {
      if (!subjectKeys) {
        const out: Record<string, string> = {};
        for (const k of Object.keys(archived)) out[k] = "[shredded]";
        return out;
      }
      return revealArchived(subjectKeys, subjectId, archived);
    },
    erase(subjectId) {
      if (!subjectKeys) return false;
      return eraseSubject(subjectKeys, subjectId);
    },
    async close() {
      if (store) {
        await store.close();
        store = undefined;
      }
    },
  };
}

export {
  filesRunsDriver,
  memoryRunsDriver,
  postgresRunsDriver,
  clickhouseRunsDriver,
};
