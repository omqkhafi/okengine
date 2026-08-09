/**
 * Durable flow runner — journals every fx call when `durable: true`.
 *
 * Workflows are not a separate API: an ordinary flow with one option.
 * A process killed between steps resumes at the failed step; the prior
 * step never re-runs (four-applications · Provisions).
 */

import { fxRetry } from "../../kernel/concurrency.ts";
import { failureCodeOf, rebindUndosFromDo, runCompensationPhase } from "../../kernel/compensate.ts";
import type { AnyFlowDef } from "../../kernel/flow.ts";
import { createFxContext, type CreateFxOptions, type Fx } from "../../kernel/fx.ts";
import { isFlowFailure } from "../../kernel/hooks.ts";
import {
  createJournal,
  isJournalSuspend,
  type Journal,
  type JournalLeaseOptions,
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
  /**
   * Run-level lease (SKIP LOCKED + lazy reclaim when the store supports it).
   * Resume throws `JournalLeaseBusy` when another live instance holds the run.
   */
  readonly lease?: JournalLeaseOptions;
  /** Injectable clock. */
  readonly now?: () => number;
  /** Extra fx options (secrets, store runtime, …). */
  readonly fx?: Omit<CreateFxOptions, "flow" | "effects" | "capability" | "now" | "journal">;
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
    ...(options.lease ? { lease: options.lease } : {}),
  });

  if (options.runId) {
    const existing = await options.journalStore.get(options.runId);
    if (!existing) {
      return {
        status: "failed",
        runId: options.runId,
        error: `journal: run "${options.runId}" not found`,
      };
    }
    if (existing.status === "failed" || existing.status === "completed") {
      return {
        status: "failed",
        runId: existing.id,
        error: existing.error ?? `journal: run is already ${existing.status}`,
      };
    }
    if (existing.wakeAt !== undefined && now() < existing.wakeAt) {
      const sleepEntry = [...existing.entries].reverse().find((e) => e.kind === "sleep");
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
    effects: options.flow.effects,
    now,
    journal: session,
    durable: true,
  });

  if (session.run.status === "compensating") {
    await rebindUndosFromDo(options.flow, options.input, fx, session);
    const priorError = session.run.error ?? "Error";
    await runCompensationPhase({
      flow: options.flow,
      input: options.input,
      session,
      fx,
      error: new Error(priorError),
    });
    return {
      status: "failed",
      runId: session.runId,
      error: session.run.error ?? priorError,
    };
  }

  try {
    const run = () => {
      // Same journal session across attempts — rewind so completed steps replay.
      session.rewind();
      return options.flow.do(options.input as never, fx);
    };
    const output = await (options.flow.retry ? fxRetry(run, options.flow.retry) : run());
    if (isFlowFailure(output)) {
      await runCompensationPhase({
        flow: options.flow,
        input: options.input,
        session,
        fx,
        error: output,
      });
      return {
        status: "failed",
        runId: session.runId,
        error: session.run.error ?? failureCodeOf(output),
      };
    }
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
    await runCompensationPhase({
      flow: options.flow,
      input: options.input,
      session,
      fx,
      error: err,
    });
    return {
      status: "failed",
      runId: session.runId,
      error: session.run.error ?? failureCodeOf(err),
    };
  }
}

/**
 * Bind a journal session onto an existing {@link Fx} factory path —
 * re-exported type helper for tests that build fx directly.
 */
export type { JournalSession, Fx };
