/**
 * `okengine/journal` — durable-run journal stores.
 *
 * @module
 */

export {
  createJournal,
  createMemoryJournalStore,
  createFileJournalStore,
  hasJournalLease,
  isJournalLeaseBusy,
  JournalLeaseBusy,
  JOURNAL_DEFAULT_LEASE_MS,
  type Journal,
  type JournalLeaseOptions,
  type JournalLeaseStore,
  type JournalStore,
  type JournalRun,
} from "./kernel/journal.ts";
