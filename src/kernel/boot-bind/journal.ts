/**
 * Lazy journal binder — loaded only when a flow declares `durable: true`.
 */

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createFileJournalStore,
  createMemoryJournalStore,
  JOURNAL_DEFAULT_LEASE_MS,
  type JournalStore,
} from "../journal.ts";
import { createPostgresJournalStore } from "../../drivers/journal-postgres.ts";
import { resolveDriverId, type ConfigEnv } from "../../config/index.ts";
import { JOURNAL_DEFAULTS } from "../../config/driver-defaults.ts";
import type { BootOptions } from "../boot.ts";
import { resolveInstanceId } from "../instance-id.ts";

/** Bound journal runtime — store + this instance's lease identity. */
export interface JournalRuntime {
  readonly store: JournalStore;
  readonly instanceId: string;
  readonly leaseMs: number;
  readonly driverId: string;
}

/** Result of binding a journal runtime. */
export interface BindJournalResult {
  readonly journal: JournalRuntime;
}

/** Default on-disk journal path (single-host file driver). */
export const DEFAULT_FILE_JOURNAL_PATH = ".oke/journal.json";

/**
 * Resolve `drivers.journal` for the active env (default `memory`).
 *
 * @param options - Boot options
 * @param env - Active environment
 */
export function resolveJournalDriverId(options: BootOptions, env: ConfigEnv): string {
  // Defaults cover every ConfigEnv key, so this is never undefined.
  return resolveDriverId(options.config?.drivers?.journal, env, JOURNAL_DEFAULTS)!;
}

/**
 * Construct a journal store. Supported ids: `memory` · `file` · `postgres`.
 *
 * @param options - Boot options
 * @param env - Active environment
 */
export async function bindJournal(
  options: BootOptions,
  env: ConfigEnv,
): Promise<BindJournalResult> {
  const driver = resolveJournalDriverId(options, env);
  const instanceId = resolveInstanceId(options.instanceId);

  let store: JournalStore;
  if (driver === "memory") {
    store = createMemoryJournalStore();
  } else if (driver === "file") {
    const path = resolve(process.cwd(), DEFAULT_FILE_JOURNAL_PATH);
    mkdirSync(dirname(path), { recursive: true });
    store = createFileJournalStore(path);
  } else if (driver === "postgres") {
    const url = process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL ?? undefined;
    if (!url) {
      throw new Error(
        env === "dev"
          ? 'oke boot: journal driver "postgres" needs DATABASE_URL (did `oke dev` write .env.local?)'
          : 'oke boot: journal driver "postgres" needs DATABASE_URL',
      );
    }
    store = await createPostgresJournalStore({ url });
  } else {
    throw new Error(
      `oke boot: unknown journal driver "${driver}" (expected memory · file · postgres)`,
    );
  }

  return {
    journal: {
      store,
      instanceId,
      leaseMs: options.journalLeaseMs ?? JOURNAL_DEFAULT_LEASE_MS,
      driverId: driver,
    },
  };
}
