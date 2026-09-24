/**
 * React hook for one agent run: send, stream, approve, and follow the resume.
 *
 * Import from `okengine/client-react`. This file does not import `okengine/client`.
 */

import { useCallback, useState } from "react";
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
  readonly headers?: HeadersInit;
}

/**
 * Send one message and keep the events, the text so far, and a pending approval.
 *
 * After an interrupt, the hook follows the run and keeps reading until
 * `RUN_FINISHED`.
 *
 * @param options - Send, approve, deny, and follow URLs
 */
export function useAgentRun(options: UseAgentRunOptions): AgentRunState {
  const [events, setEvents] = useState<ParsedAgentEvent[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<AgentPendingApproval | null>(null);
  const [status, setStatus] = useState<AgentRunState["status"]>("idle");

  const consume = useCallback(
    async (source: Response | string, lastEventId?: string) => {
      for await (const event of readAgentEvents(source, {
        fetch: options.fetch,
        headers: options.headers,
        ...(lastEventId !== undefined ? { lastEventId } : {}),
      })) {
        setEvents((prev) => [...prev, event]);
        if (event.type === "TEXT_MESSAGE_CONTENT") {
          setText((prev) => prev + event.delta);
        }
        if (event.type === "RUN_FINISHED" && event.outcome?.type === "interrupt") {
          const first = event.outcome.interrupts[0];
          const payload = first?.payload as { tool?: string; args?: unknown } | undefined;
          if (first) {
            setPending({
              id: first.id,
              ...(payload?.tool !== undefined ? { tool: payload.tool } : {}),
              ...(payload?.args !== undefined ? { args: payload.args } : {}),
            });
            setStatus("approval");
          }
          return event.runId;
        }
        if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") {
          setPending(null);
          setStatus(event.type === "RUN_ERROR" ? "error" : "done");
        }
      }
      return undefined;
    },
    [options.fetch, options.headers],
  );

  const send = useCallback(
    async (message: string) => {
      setStatus("streaming");
      setText("");
      setEvents([]);
      setPending(null);
      const fetcher = options.fetch ?? fetch;
      const response = await fetcher(options.sendUrl, {
        method: "POST",
        headers: { "content-type": "application/json", ...headersOf(options.headers) },
        body: JSON.stringify({ message }),
      });
      const runId = await consume(response);
      if (runId) {
        await consume(options.followUrl(runId));
      }
    },
    [consume, options.fetch, options.followUrl, options.headers, options.sendUrl],
  );

  const approvePending = useCallback(
    async (args?: unknown) => {
      if (!pending) return;
      await approve(options.approveUrl, pending.id, args, { fetch: options.fetch });
      setStatus("streaming");
    },
    [options.approveUrl, options.fetch, pending],
  );

  const denyPending = useCallback(
    async (reason?: string) => {
      if (!pending) return;
      await deny(options.denyUrl, pending.id, reason, { fetch: options.fetch });
      setStatus("streaming");
    },
    [options.denyUrl, options.fetch, pending],
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

function headersOf(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers;
}
