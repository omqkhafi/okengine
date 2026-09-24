/**
 * Parse AG-UI agent events from JSON or SSE.
 *
 * Import from `okengine/client/agent`. This stays off the core `okengine/client`
 * graph. Wire `CUSTOM` events stay `CUSTOM`. The three OKE subagent names are
 * also returned as typed variants.
 */

import type { AgUiEvent } from "../elements/ai/events.ts";

/** Typed subagent notice parsed from `CUSTOM`. */
export type ParsedSubagentEvent =
  | {
      readonly type: "subagent.started";
      readonly runId: string;
      readonly parentToolCallId?: string;
    }
  | {
      readonly type: "subagent.finished";
      readonly runId: string;
      readonly parentToolCallId?: string;
    }
  | {
      readonly type: "subagent.error";
      readonly runId: string;
      readonly parentToolCallId?: string;
      readonly message?: string;
    };

/** One event from {@link parseAgentEvent}. */
export type ParsedAgentEvent = AgUiEvent | ParsedSubagentEvent;

const SUBAGENT_NAMES = {
  "oke.subagent.started": "subagent.started",
  "oke.subagent.finished": "subagent.finished",
  "oke.subagent.error": "subagent.error",
} as const;

/**
 * Parse one JSON event. Unknown objects return undefined.
 *
 * @param data - Parsed JSON value
 */
export function parseAgentEvent(data: unknown): ParsedAgentEvent | undefined {
  if (typeof data !== "object" || data === null || !("type" in data)) return undefined;
  const event = data as AgUiEvent;
  if (event.type !== "CUSTOM") return event;
  const kind = SUBAGENT_NAMES[event.name as keyof typeof SUBAGENT_NAMES];
  if (!kind) return event;
  const value =
    typeof event.value === "object" && event.value !== null
      ? (event.value as { runId?: unknown; parentToolCallId?: unknown; message?: unknown })
      : {};
  const runId = typeof value.runId === "string" ? value.runId : "";
  const parentToolCallId =
    typeof value.parentToolCallId === "string" ? value.parentToolCallId : undefined;
  if (kind === "subagent.error") {
    return {
      type: kind,
      runId,
      ...(parentToolCallId !== undefined ? { parentToolCallId } : {}),
      ...(typeof value.message === "string" ? { message: value.message } : {}),
    };
  }
  return {
    type: kind,
    runId,
    ...(parentToolCallId !== undefined ? { parentToolCallId } : {}),
  };
}

/**
 * Read `data:` frames from an SSE response body.
 *
 * @param response - `text/event-stream` response
 */
export async function* readAgentEvents(response: Response): AsyncIterable<ParsedAgentEvent> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      const parsed = parseAgentEvent(JSON.parse(data) as unknown);
      if (parsed) yield parsed;
    }
  }
}
