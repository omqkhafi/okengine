/**
 * Console fleet projection — read-only join over the host instance registry.
 *
 * Does not heartbeat. Unbound / unreachable store → `{ kind: "empty" }`.
 */

import { createPostgresCronStore } from "../../drivers/clock-postgres.ts";
import { createPostgresInstanceStore } from "../../drivers/instances-postgres.ts";
import { createPostgresJournalStore } from "../../drivers/journal-postgres.ts";
import type { CronStore } from "../../elements/clock/reconcile.ts";
import type { JournalStore } from "../../kernel/journal.ts";
import {
  projectInstancesList,
  type InstanceStore,
  type InstancesList,
} from "../../kernel/instances.ts";
import type { ConsoleState } from "./state.ts";

/** Shared SQL URL used by the host Clock / Journal / fleet registry. */
function sharedSqlUrl(): string | undefined {
  return process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL ?? undefined;
}

/**
 * Open host postgres stores for the fleet join when they are not injected.
 * Failures stay silent — Monitoring shows `empty`, not a fake zero.
 *
 * @param state - Console state
 */
export async function bindHostFleetStores(state: ConsoleState): Promise<void> {
  if (state.instanceStore) return;
  const url = sharedSqlUrl();
  if (!url) return;
  try {
    state.instanceStore = await createPostgresInstanceStore({ url });
    state.fleetCronStore ??= await createPostgresCronStore({ url });
    state.journalStore ??= await createPostgresJournalStore({ url });
  } catch {
    state.instanceStore = null;
  }
}

/**
 * Project `GET /console/instances`.
 *
 * @param state - Console state
 */
export async function listConsoleInstances(state: ConsoleState): Promise<InstancesList> {
  await bindHostFleetStores(state);
  return projectInstancesList({
    store: state.instanceStore,
    clock: state.fleetCronStore ?? state.clockRuntime?.store ?? null,
    journal: state.journalStore,
    now: state.now,
  });
}

export type { CronStore, InstanceStore, InstancesList, JournalStore };
