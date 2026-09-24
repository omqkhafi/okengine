/**
 * AG-UI event shapes for agent streams.
 *
 * Field names match the AG-UI core events a strict parser accepts.
 * Subagent notices are `CUSTOM` (`oke.subagent.*`), not extra event types.
 * `cost` and `stopReason` ride on `RUN_FINISHED.result`.
 */

/** Numeric token usage AG-UI allows on `RUN_FINISHED`. */
export interface AgUiUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/** One AG-UI event yielded by a streaming agent run. */
export type AgUiEvent =
  | {
      readonly type: "RUN_STARTED";
      readonly threadId: string;
      readonly runId: string;
      readonly parentRunId?: string;
    }
  | {
      readonly type: "TEXT_MESSAGE_START";
      readonly messageId: string;
      readonly role: "assistant";
    }
  | {
      readonly type: "TEXT_MESSAGE_CONTENT";
      readonly messageId: string;
      readonly delta: string;
    }
  | { readonly type: "TEXT_MESSAGE_END"; readonly messageId: string }
  | {
      readonly type: "TOOL_CALL_START";
      readonly toolCallId: string;
      readonly toolCallName: string;
      readonly parentMessageId?: string;
    }
  | { readonly type: "TOOL_CALL_ARGS"; readonly toolCallId: string; readonly delta: string }
  | { readonly type: "TOOL_CALL_END"; readonly toolCallId: string }
  | {
      readonly type: "TOOL_CALL_RESULT";
      readonly messageId: string;
      readonly toolCallId: string;
      readonly content: string;
      readonly role: "tool";
    }
  | { readonly type: "STEP_STARTED"; readonly stepName: string }
  | { readonly type: "STEP_FINISHED"; readonly stepName: string }
  | {
      readonly type: "RUN_FINISHED";
      readonly threadId: string;
      readonly runId: string;
      readonly result?: {
        readonly cost: number;
        readonly stopReason: string;
        readonly output?: unknown;
      };
      readonly usage?: readonly AgUiUsage[];
      readonly outcome?: {
        readonly type: "interrupt";
        readonly interrupts: readonly {
          readonly id: string;
          readonly reason: string;
          readonly payload?: unknown;
        }[];
      };
    }
  | { readonly type: "RUN_ERROR"; readonly message: string; readonly code?: string }
  | { readonly type: "CUSTOM"; readonly name: string; readonly value: unknown };

/** Push one event into a live stream. */
export type AgentEventEmit = (event: AgUiEvent) => void;

/**
 * Queue so a tool loop can emit while the caller iterates.
 *
 * @returns Emit handle plus the iterable the caller reads
 */
export function createEventQueue(): {
  readonly emit: AgentEventEmit;
  readonly finish: (error?: unknown) => void;
  readonly events: AsyncIterable<AgUiEvent>;
} {
  const pending: AgUiEvent[] = [];
  let wake: (() => void) | undefined;
  let done = false;
  let error: unknown;
  const poke = (): void => {
    const waiting = wake;
    wake = undefined;
    waiting?.();
  };
  return {
    emit(event) {
      pending.push(event);
      poke();
    },
    finish(err) {
      done = true;
      error = err;
      poke();
    },
    events: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (pending.length > 0) yield pending.shift()!;
          if (done) {
            if (error !== undefined) throw error;
            return;
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      },
    },
  };
}

/**
 * Emit one assistant text message as start / content / end.
 *
 * @param emit - Stream sink
 * @param messageId - AG-UI message id
 * @param text - Full assistant text for this step
 */
export function emitAssistantText(emit: AgentEventEmit, messageId: string, text: string): void {
  if (!text) return;
  emit({ type: "TEXT_MESSAGE_START", messageId, role: "assistant" });
  emit({ type: "TEXT_MESSAGE_CONTENT", messageId, delta: text });
  emit({ type: "TEXT_MESSAGE_END", messageId });
}
