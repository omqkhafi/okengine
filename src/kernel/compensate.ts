/**
 * Durable compensation phase — auto per-step undos then optional flow.compensate.
 *
 * Runs under the same journal session after terminal failure. Uses status
 * `compensating` so orphan reclaim resumes undos instead of forward `do`.
 */

import type { AnyFlowDef } from "./flow.ts";
import { fail, OkeError, type FlowFailure } from "./errors.ts";
import type { Fx } from "./fx.ts";
import { isFlowFailure } from "./hooks.ts";
import { JOURNAL_UNDO_PREFIX, type JournalSession, type JournalStepEntry } from "./journal.ts";

/**
 * Machine-readable code for journal / Runs failure fields.
 *
 * @param err - Thrown value or {@link FlowFailure}
 */
export function failureCodeOf(err: unknown): string {
  if (isFlowFailure(err)) return err.error.code;
  if (err instanceof OkeError) return `OKE${err.code}`;
  if (err instanceof Error && err.name && err.name !== "Error") return err.name;
  if (err instanceof Error && err.message) return err.message.slice(0, 120);
  return "Error";
}

/**
 * Coerce a thrown value into a {@link FlowFailure} for Runs wide events.
 *
 * {@link OkeError} keeps its numeric code and cause so Traces can show
 * `OKE1002` instead of a bare `OkeError` with no message.
 *
 * @param err - Thrown value or {@link FlowFailure}
 */
export function failureFromUnknown(err: unknown): FlowFailure {
  if (isFlowFailure(err)) return err;
  if (err instanceof OkeError) {
    return fail(`OKE${err.code}`, { ...err.params }, { message: err.causeText });
  }
  const message = err instanceof Error ? err.message : undefined;
  return fail(failureCodeOf(err), {}, message !== undefined ? { message } : undefined);
}

/** Forward step names only (excludes journaled `undo:*` entries). */
export function forwardCompletedSteps(session: JournalSession): readonly string[] {
  return session.run.entries
    .filter(
      (e): e is JournalStepEntry => e.kind === "step" && !e.name.startsWith(JOURNAL_UNDO_PREFIX),
    )
    .map((e) => e.name);
}

/** Options for {@link runCompensationPhase}. */
export interface RunCompensationPhaseOptions {
  /** Flow definition (optional `compensate` hook). */
  readonly flow: AnyFlowDef;
  /** Original flow input. */
  readonly input: unknown;
  /** Active journal session. */
  readonly session: JournalSession;
  /** Fx bound to the same journal. */
  readonly fx: Fx;
  /** Terminal failure that triggered compensation. */
  readonly error: unknown;
}

/**
 * Enter compensating status, run LIFO per-step undos, then `flow.compensate`,
 * and commit `failed`.
 *
 * @param options - Session, fx, terminal error
 */
export async function runCompensationPhase(options: RunCompensationPhaseOptions): Promise<void> {
  const { flow, input, session, fx, error } = options;
  const terminalCode = failureCodeOf(error);

  if (session.run.status !== "compensating") {
    await session.commit("compensating", { error: terminalCode });
  }

  session.setUndoExecution(true);
  try {
    const stack = [...session.undoStack()].reverse();
    for (const frame of stack) {
      const undoName = `${JOURNAL_UNDO_PREFIX}${frame.name}`;
      await session.step(undoName, () => frame.undo(frame.value));
    }

    if (flow.compensate) {
      try {
        await flow.compensate(
          {
            input: input as never,
            error,
            completedSteps: forwardCompletedSteps(session),
          },
          fx,
        );
      } catch (compErr) {
        await session.commit("failed", {
          error: `compensate:${failureCodeOf(compErr)}`,
        });
        return;
      }
    }

    if (session.run.status === "compensating" || session.run.status === "running") {
      await session.commit("failed", { error: terminalCode });
    }
  } catch (undoErr) {
    if (session.run.status !== "failed") {
      await session.commit("failed", {
        error: `compensate:${failureCodeOf(undoErr)}`,
      });
    }
  } finally {
    session.setUndoExecution(false);
  }
}

/**
 * Re-bind per-step undos by re-entering `do` without new forward work.
 *
 * @param flow - Flow definition
 * @param input - Original input
 * @param fx - Fx bound to the journal
 * @param session - Compensating session
 */
export async function rebindUndosFromDo(
  flow: AnyFlowDef,
  input: unknown,
  fx: Fx,
  session: JournalSession,
): Promise<void> {
  session.rewind();
  session.beginRegistrationPass();
  try {
    await flow.do(input as never, fx);
  } catch {
    // JournalRegistrationComplete = caught up with journaled forwards.
    // Other throws while replaying between steps: keep whatever undos bound.
  } finally {
    session.endRegistrationPass();
  }
}
