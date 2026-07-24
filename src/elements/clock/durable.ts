/**
 * Durable flow runner — journals every fx call when `durable: true`.
 *
 * Workflows are not a separate API: an ordinary flow with one option.
 * A process killed between steps resumes at the failed step; the prior
 * step never re-runs (four-applications · Provisions).
 */

import type { AnyFlowDef } from "../../kernel/flow.ts";
import {
  createFxContext,
  type CreateFxOptions,
  type Fx,
} from "../../kernel/fx.ts";
import {
  createJournal,
  isJournalSuspend,
  type Journal,
  type JournalSession,
  type JournalStore,
} from "../../kernel/journal.ts";
/** Outcome of one durable attempt. */
export type DurableResult<O = unknown> =
  | {
      readonly status: "completed";
      readonly runId: string;
      readonly output: O;
    }
  | {
      readonly status: "sleeping";
      readonly runId: string;
      readonly wakeAt: number;
      readonly label: string;
    }
  | {
      readonly status: "failed";
      readonly runId: string;
      readonly error: string;
    };

/** Options for {@link runDurable}. */
export interface RunDurableOptions {
  /** Flow with `durable: true` (or forced via this runner). */
  readonly flow: AnyFlowDef;
  /** Input payload. */
  readonly input?: unknown;
  /** Journal store (memory or file). */
  readonly journalStore: JournalStore;
  /** Resume an existing run id (crash recovery). */
  readonly runId?: string;
  /** Injectable clock. */
  readonly now?: () => number;
  /** Extra fx options (secrets, store runtime, …). */
  readonly fx?: Omit<
    CreateFxOptions,
    "flow" | "effects" | "capability" | "now" | "journal"
  >;
}

/**
 * Execute (or resume) a durable flow against a journal.
 *
 * @param options - Flow, input, journal, clock
 */
export async function runDurable<O = unknown>(
  options: RunDurableOptions,
): Promise<DurableResult<O>> {
  const now = options.now ?? (() => Date.now());
  const journal: Journal = createJournal({
    store: options.journalStore,
    now,
  });

  if (options.runId) {
    const existing = await options.journalStore.get(options.runId);
    if (
      existing?.wakeAt !== undefined &&
      now() < existing.wakeAt
    ) {
      const sleepEntry = [...existing.entries]
        .reverse()
        .find((e) => e.kind === "sleep");
      return {
        status: "sleeping",
        runId: existing.id,
        wakeAt: existing.wakeAt,
        label: sleepEntry && sleepEntry.kind === "sleep" ? sleepEntry.label : "",
      };
    }
  }

  const session: JournalSession = options.runId
    ? await journal.resume(options.runId)
    : await journal.start(options.flow.name, options.input);

  if (session.run.status === "sleeping") {
    session.run.status = "running";
  }

  const { fx } = createFxContext({
    ...options.fx,
    flow: options.flow.name,
    effects: options.flow.effects ?? {},
    now,
    journal: session,
    durable: true,
  });

  try {
    const output = await options.flow.do(options.input as never, fx);
    await session.commit("completed", { output });
    return {
      status: "completed",
      runId: session.runId,
      output: output as O,
    };
  } catch (err) {
    if (isJournalSuspend(err)) {
      return {
        status: "sleeping",
        runId: session.runId,
        wakeAt: err.wakeAt,
        label: err.label,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    await session.commit("failed", { error: message });
    return {
      status: "failed",
      runId: session.runId,
      error: message,
    };
  }
}

/**
 * Bind a journal session onto an existing {@link Fx} factory path —
 * re-exported type helper for tests that build fx directly.
 */
export type { JournalSession, Fx };
