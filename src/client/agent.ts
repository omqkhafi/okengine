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
 * Pass a URL to follow a run: the generator reconnects and sends
 * `Last-Event-ID` from the last frame it yielded.
 *
 * @param source - One response, or the follow URL
 * @param init - Fetch, abort, and a starting event id
 */
export async function* readAgentEvents(
  source: Response | string | URL,
  init?: AgentFollowInit,
): AsyncIterable<ParsedAgentEvent> {
  if (source instanceof Response) {
    yield* readAgentEventResponse(source, init);
    return;
  }
  const fetcher = init?.fetch ?? fetch;
  let lastEventId = init?.lastEventId;
  let delayMs = 250;
  for (;;) {
    if (init?.signal?.aborted) return;
    const headers = new Headers(init?.headers);
    if (lastEventId) headers.set("last-event-id", lastEventId);
    let response: Response;
    try {
      response = await fetcher(source, { headers, signal: init?.signal });
    } catch (err) {
      if (init?.signal?.aborted) return;
      init?.trace?.(err instanceof Error ? err.message : "agent events: network error");
      await wait(delayMs, init?.signal);
      delayMs = Math.min(delayMs * 2, 10_000);
      continue;
    }
    delayMs = 250;
    if (!response.ok) throw new Error(`agent events: HTTP ${response.status}`);
    let sawFrame = false;
    try {
      for await (const frame of readAgentEventFrames(response, init?.trace)) {
        sawFrame = true;
        if (frame.id) {
          lastEventId = frame.id;
          init?.onId?.(frame.id);
        }
        if (frame.event) yield frame.event;
        if (frame.event?.type === "RUN_ERROR") return;
        if (frame.event?.type === "RUN_FINISHED" && frame.event.outcome?.type !== "interrupt")
          return;
      }
    } catch (err) {
      if (init?.signal?.aborted) return;
      init?.trace?.(err instanceof Error ? err.message : "agent events: network error");
      await wait(delayMs, init?.signal);
      delayMs = Math.min(delayMs * 2, 10_000);
      continue;
    }
    if (!sawFrame || init?.signal?.aborted) return;
  }
}

/** Options for {@link approve} and {@link deny}. */
export interface AgentDecisionInit {
  readonly fetch?: typeof fetch;
  /** Cap on lease retries. Default 5. */
  readonly attempts?: number;
  readonly headers?: Record<string, string>;
}

/**
 * Approve a parked tool. Retries `JournalLeaseBusy`. Throws on `Conflict`.
 *
 * @param url - Approve route (`/agent/approvals/approve`)
 * @param id - Approval id
 * @param args - Replacement tool input
 * @param init - Fetch override
 */
export async function approve(
  url: string,
  id: string,
  args?: unknown,
  init?: AgentDecisionInit,
): Promise<void> {
  await postDecision(url, { id, ...(args !== undefined ? { args } : {}) }, init);
}

/**
 * Deny a parked tool. Retries `JournalLeaseBusy`. Throws on `Conflict`.
 *
 * @param url - Deny route (`/agent/approvals/deny`)
 * @param id - Approval id
 * @param reason - Text the model sees
 * @param init - Fetch override
 */
export async function deny(
  url: string,
  id: string,
  reason?: string,
  init?: AgentDecisionInit,
): Promise<void> {
  await postDecision(url, { id, ...(reason !== undefined ? { reason } : {}) }, init);
}

/** Follow options for {@link readAgentEvents}. */
export interface AgentFollowInit {
  readonly fetch?: typeof fetch;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
  readonly lastEventId?: string;
  /** Called with each SSE id as it is read. */
  onId?(id: string): void;
  /** Called when a frame cannot be parsed. The frame is skipped. */
  trace?(message: string): void;
}

async function* readAgentEventResponse(
  response: Response,
  init?: AgentFollowInit,
): AsyncIterable<ParsedAgentEvent> {
  for await (const frame of readAgentEventFrames(response, init?.trace)) {
    if (frame.id) init?.onId?.(frame.id);
    if (frame.event) yield frame.event;
  }
}

async function* readAgentEventFrames(
  response: Response,
  trace?: (message: string) => void,
): AsyncIterable<{ id?: string; event?: ParsedAgentEvent }> {
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
      const lines = frame.split("\n");
      const idLine = lines.find((line) => line.startsWith("id:"));
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      let parsed: ParsedAgentEvent | undefined;
      try {
        parsed = parseAgentEvent(JSON.parse(data) as unknown);
      } catch (err) {
        trace?.(err instanceof Error ? err.message : "agent events: malformed frame");
        continue;
      }
      yield {
        ...(idLine ? { id: idLine.slice(3).trim() } : {}),
        ...(parsed ? { event: parsed } : {}),
      };
    }
  }
}

async function postDecision(
  url: string,
  body: { id: string; args?: unknown; reason?: string },
  init?: AgentDecisionInit,
): Promise<void> {
  const fetcher = init?.fetch ?? fetch;
  const attempts = init?.attempts ?? 5;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headersOf(init?.headers) },
      body: JSON.stringify(body),
    });
    if (response.ok) return;
    const payload = (await response.json().catch(() => ({}))) as {
      error?: { code?: string };
    };
    const code = payload.error?.code;
    if (response.status === 409 && code === "JournalLeaseBusy") {
      const retryAfter = retryAfterMs(response.headers.get("retry-after"));
      await new Promise((resolve) => setTimeout(resolve, retryAfter));
      continue;
    }
    if (response.status === 409 && code === "Conflict") {
      const error = new Error("That value is already in use.");
      error.name = "Conflict";
      throw error;
    }
    const error = new Error(code ?? `agent decision: HTTP ${response.status}`);
    error.name = code ?? "Error";
    throw error;
  }
  const error = new Error("This run is locked by another worker. Retry after the given delay.");
  error.name = "JournalLeaseBusy";
  throw error;
}

/**
 * `Retry-After` as delta-seconds or an HTTP-date.
 *
 * @param header - Header value
 */
function retryAfterMs(header: string | null): number {
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1000;
  const at = Date.parse(header);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, at - Date.now());
}

function headersOf(headers: Record<string, string> | undefined): Record<string, string> {
  return headers ?? {};
}

/**
 * Wait, or return early when `signal` aborts.
 *
 * @param ms - Delay
 * @param signal - Abort
 */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
