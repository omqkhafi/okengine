/**
 * Graceful shutdown — release Clock / Journal leases and the fleet registry
 * row held by this instance, then stop the HTTP server and close element
 * runtimes.
 *
 * Reuses existing `releaseLease` APIs. Signal message leases have no release
 * surface today — survivors reclaim after TTL (lazy claim).
 */

import { releaseLease } from "../elements/clock/leader.ts";
import type { CronStore } from "../elements/clock/reconcile.ts";
import type { ServerHandle } from "../runtime/types.ts";
import { hasJournalLease, type JournalStore } from "./journal.ts";

/** Minimal app surface for shutdown. */
export interface GracefulShutdownApp {
  readonly bootResult?: {
    readonly clock?: {
      readonly instanceId: string;
      readonly store: CronStore;
      now(): number;
    };
    readonly journal?: {
      readonly instanceId: string;
      readonly store: JournalStore;
    };
    readonly instances?: {
      release(): Promise<void>;
    };
  };
  stop(): Promise<void>;
}

/**
 * Release Clock cron leases, Journal run leases, and this process's fleet row.
 *
 * @param app - Booted app
 */
export async function releaseInstanceLeases(app: GracefulShutdownApp): Promise<void> {
  const boot = app.bootResult;
  if (!boot) return;

  const clock = boot.clock;
  if (clock) {
    const t = clock.now();
    for (const row of await clock.store.list()) {
      if (row.leaderInstanceId === clock.instanceId) {
        await releaseLease(clock.store, row.name, clock.instanceId, t);
      }
    }
  }

  const journal = boot.journal;
  if (journal && hasJournalLease(journal.store)) {
    for (const run of await journal.store.list()) {
      if (run.lockedBy === journal.instanceId) {
        await journal.store.releaseLease(run.id, journal.instanceId);
      }
    }
  }

  await boot.instances?.release();
}

/** Options for {@link installGracefulShutdown}. */
export interface InstallGracefulShutdownOptions {
  readonly app: GracefulShutdownApp;
  readonly handle?: ServerHandle;
  /** Signals to listen for (default SIGTERM + SIGINT). */
  readonly signals?: readonly NodeJS.Signals[];
  /** Exit after shutdown (default true). */
  readonly exit?: boolean;
}

/**
 * Register SIGTERM/SIGINT handlers that release leases, drain the server,
 * and stop the app.
 *
 * @param options - App + optional server handle
 * @returns Dispose function that removes the handlers
 */
export function installGracefulShutdown(options: InstallGracefulShutdownOptions): () => void {
  const signals = options.signals ?? (["SIGTERM", "SIGINT"] as const);
  let shuttingDown = false;

  const onSignal = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void (async () => {
      try {
        // Stop accepting new connections first (keep in-flight open).
        options.handle?.stop(false);
        await releaseInstanceLeases(options.app);
        await options.app.stop();
      } catch (err) {
        console.error("oke: graceful shutdown failed", err);
      } finally {
        if (options.exit !== false) process.exit(0);
      }
    })();
  };

  for (const signal of signals) {
    process.on(signal, onSignal);
  }

  return () => {
    for (const signal of signals) {
      process.off(signal, onSignal);
    }
  };
}
