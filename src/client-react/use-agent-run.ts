/**
 * React hook for one agent run: send, stream, approve, and follow the resume.
 *
 * Import from `okengine/client-react`. This file does not import `okengine/client`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  approve,
  deny,
  readAgentEvents,
  type ParsedAgentEvent,
} from "../client/agent.ts";

/** Pending tool approval from a `RUN_FINISHED` interrupt. */
export interface AgentPendingApproval {
  readonly id: string;
  readonly tool?: string;
  readonly args?: unknown;
}

/** State returned by {@link useAgentRun}. */
export interface AgentRunState {
  readonly events: readonly ParsedAgentEvent[];
  readonly text: string;
  readonly pending: AgentPendingApproval | null;
  readonly status: "idle" | "streaming" | "approval" | "done" | "error";
  send(message: string): Promise<void>;
  approve(args?: unknown): Promise<void>;
  deny(reason?: string): Promise<void>;
}

/** Routes the hook calls. */
export interface UseAgentRunOptions {
  /** POST that starts `fx.run(..., { stream: true })`. */
  readonly sendUrl: string;
  /** POST `/agent/approvals/approve`. */
  readonly approveUrl: string;
  /** POST `/agent/approvals/deny`. */
  readonly denyUrl: string;
  /** Follow URL for a run id. */
  followUrl(runId: string): string;
  readonly fetch?: typeof fetch;
  readonly headers?: Record<string, string>;
}

/**
 * Send one message and keep the events, the text so far, and a pending approval.
 *
 * After an interrupt, the hook follows with `Last-Event-ID`. Approve and deny
 * follow again until the terminal `RUN_FINISHED`. Unmount aborts the stream.
 *
 * @param options - Send, approve, deny, and follow URLs
 */
export function useAgentRun(options: UseAgentRunOptions): AgentRunState {
  const [events, setEvents] = useState<ParsedAgentEvent[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<AgentPendingApproval | null>(null);
  const [status, setStatus] = useState<AgentRunState["status"]>("idle");
  const lastId = useRef<string | undefined>(undefined);
  const runIdRef = useRef<string | undefined>(undefined);
  const seenInterrupt = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    return () => {
      controller.abort();
      abortRef.current = undefined;
    };
  }, []);

  const consume = useCallback(
    async (source: Response | string, lastEventId?: string): Promise<string | undefined> => {
      let followed: string | undefined;
      for await (const event of readAgentEvents(source, {
        fetch: options.fetch,
        headers: options.headers,
        signal: abortRef.current?.signal,
        ...(lastEventId !== undefined ? { lastEventId } : {}),
        onId(id) {
          lastId.current = id;
        },
      })) {
        if (
          event.type === "RUN_FINISHED" &&
          event.outcome?.type === "interrupt" &&
          seenInterrupt.current === event.outcome.interrupts[0]?.id
        ) {
          continue;
        }
        setEvents((prev) => [...prev, event]);
        if (event.type === "TEXT_MESSAGE_CONTENT") {
          setText((prev) => prev + event.delta);
        }
        if (event.type === "RUN_STARTED" && "runId" in event) {
          runIdRef.current = event.runId;
          followed = event.runId;
        }
        if (event.type === "RUN_FINISHED" && event.outcome?.type === "interrupt") {
          const first = event.outcome.interrupts[0];
          const payload = first?.payload as { tool?: string; args?: unknown } | undefined;
          if (first) {
            seenInterrupt.current = first.id;
            setPending({
              id: first.id,
              ...(payload?.tool !== undefined ? { tool: payload.tool } : {}),
              ...(payload?.args !== undefined ? { args: payload.args } : {}),
            });
            setStatus("approval");
          }
          runIdRef.current = event.runId;
          return event.runId;
        }
        if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") {
          setPending(null);
          setStatus(event.type === "RUN_ERROR" ? "error" : "done");
          if (event.type === "RUN_FINISHED") runIdRef.current = event.runId;
        }
      }
      return followed;
    },
    [options.fetch, options.headers],
  );

  const followUntilDone = useCallback(
    async (runId: string) => {
      await consume(options.followUrl(runId), lastId.current);
    },
    [consume, options.followUrl],
  );

  const send = useCallback(
    async (message: string) => {
      setStatus("streaming");
      setText("");
      setEvents([]);
      setPending(null);
      lastId.current = undefined;
      seenInterrupt.current = undefined;
      const fetcher = options.fetch ?? fetch;
      const response = await fetcher(options.sendUrl, {
        method: "POST",
        headers: { "content-type": "application/json", ...headersOf(options.headers) },
        body: JSON.stringify({ message }),
        signal: abortRef.current?.signal,
      });
      const runId = await consume(response);
      if (runId) await followUntilDone(runId);
    },
    [consume, followUntilDone, options.fetch, options.headers, options.sendUrl],
  );

  const approvePending = useCallback(
    async (args?: unknown) => {
      if (!pending) return;
      await approve(options.approveUrl, pending.id, args, {
        fetch: options.fetch,
        headers: options.headers,
      });
      setStatus("streaming");
      const runId = runIdRef.current;
      if (runId) await followUntilDone(runId);
    },
    [followUntilDone, options.approveUrl, options.fetch, options.headers, pending],
  );

  const denyPending = useCallback(
    async (reason?: string) => {
      if (!pending) return;
      await deny(options.denyUrl, pending.id, reason, {
        fetch: options.fetch,
        headers: options.headers,
      });
      setStatus("streaming");
      const runId = runIdRef.current;
      if (runId) await followUntilDone(runId);
    },
    [followUntilDone, options.denyUrl, options.fetch, options.headers, pending],
  );

  return {
    events,
    text,
    pending,
    status,
    send,
    approve: approvePending,
    deny: denyPending,
  };
}

function headersOf(headers: Record<string, string> | undefined): Record<string, string> {
  return headers ?? {};
}
