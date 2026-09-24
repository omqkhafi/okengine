/**
 * Observability AI pane — agent runs, the approval queue, and a live follow.
 */

import { useCallback, useEffect, useState, type JSX } from "react";
import {
  agentApprovalApprove,
  agentApprovalDeny,
  agentApprovalsList,
  agentRunsList,
  type AgentApprovalRow,
  type AgentRunRow,
} from "@/client.ts";
import {
  EXPLORER_COUNT_CLASS,
  EXPLORER_ROW_CLASS,
  EXPLORER_STRIP_CLASS,
  SECTION_HEAD_CLASS,
} from "@/components/explorer/explorer-chrome.ts";

/** One SSE frame from `GET /agent/runs/:runId/events`. */
export interface AgentFollowFrame {
  readonly id?: string;
  readonly data: string;
}

/**
 * Split an SSE buffer into frames. The remainder stays for the next chunk.
 *
 * @param buffer - Text received so far
 */
export function parseAgentEventFrames(buffer: string): {
  readonly frames: readonly AgentFollowFrame[];
  readonly rest: string;
} {
  const frames: AgentFollowFrame[] = [];
  let rest = buffer;
  for (;;) {
    const split = rest.indexOf("\n\n");
    if (split < 0) break;
    const block = rest.slice(0, split);
    rest = rest.slice(split + 2);
    let id: string | undefined;
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("id:")) id = line.slice(3).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (data.length === 0) continue;
    frames.push({ ...(id !== undefined ? { id } : {}), data: data.join("\n") });
  }
  return { frames, rest };
}

/**
 * Edited args. Empty means "leave the original". Any other text must be JSON.
 *
 * @param text - Textarea value
 */
export function parseApprovalArgs(
  text: string,
): { readonly ok: true; readonly value?: unknown } | { readonly ok: false } {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: true };
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * Format a pending age in seconds or minutes.
 *
 * @param ageMs - Milliseconds since the approval was requested
 */
function formatAge(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m`;
}

function tokenLabel(run: AgentRunRow): string {
  if (run.inputTokens === undefined && run.outputTokens === undefined) return "";
  return `${run.inputTokens ?? 0}/${run.outputTokens ?? 0}`;
}

/**
 * Agent runs, run detail, follow, and the approvals queue.
 *
 * @param props - Selected run from the URL
 */
export function AiRunsPanel({
  agentRunId,
  query,
  onSelectRun,
}: {
  readonly agentRunId: string | null;
  readonly query: string;
  readonly onSelectRun: (id: string | null) => void;
}): JSX.Element {
  const [runs, setRuns] = useState<readonly AgentRunRow[]>([]);
  const [rows, setRows] = useState<readonly AgentApprovalRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [argsText, setArgsText] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [follow, setFollow] = useState<readonly string[]>([]);
  const [following, setFollowing] = useState(false);

  const reload = useCallback(async () => {
    const list = await agentRunsList();
    if (list.data) setRuns(list.data.runs);
    const queue = await agentApprovalsList();
    if (queue.data) setRows(queue.data.rows);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selected = runs.find((run) => run.id === agentRunId) ?? null;

  useEffect(() => {
    if (!following || !agentRunId) return;
    const controller = new AbortController();
    let lastId = "0";
    let cancelled = false;
    const run = async (): Promise<void> => {
      const res = await fetch(`/agent/runs/${agentRunId}/events`, {
        headers: { "last-event-id": lastId, accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        setNotice(String(res.status));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done || cancelled) return;
        buffer += decoder.decode(chunk.value, { stream: true });
        const parsed = parseAgentEventFrames(buffer);
        buffer = parsed.rest;
        for (const frame of parsed.frames) {
          if (frame.id) lastId = frame.id;
          setFollow((current) => [...current, frame.data]);
        }
      }
    };
    void run().catch((err: unknown) => {
      if (!cancelled) setNotice(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [following, agentRunId]);

  async function approve(row: AgentApprovalRow): Promise<void> {
    const parsed = parseApprovalArgs(argsText[row.id] ?? "");
    if (!parsed.ok) {
      setNotice("ValidationError");
      return;
    }
    const result = await agentApprovalApprove({
      id: row.id,
      ...(parsed.value !== undefined ? { args: parsed.value } : {}),
    });
    if (result.error?.code === "Conflict") setNotice("Conflict");
    else if (result.error?.code === "JournalLeaseBusy") setNotice("JournalLeaseBusy");
    else if (result.error) setNotice(result.error.code);
    else setNotice(null);
    await reload();
  }

  async function deny(row: AgentApprovalRow): Promise<void> {
    const result = await agentApprovalDeny({
      id: row.id,
      ...(reasons[row.id] ? { reason: reasons[row.id] } : {}),
    });
    if (result.error?.code === "Conflict") setNotice("Conflict");
    else if (result.error?.code === "JournalLeaseBusy") setNotice("JournalLeaseBusy");
    else if (result.error) setNotice(result.error.code);
    else setNotice(null);
    await reload();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto" data-slot="observability-ai-runs">
      <div className={EXPLORER_STRIP_CLASS}>
        <span className={`${SECTION_HEAD_CLASS} px-2.5`}>Agent runs</span>
        <span className={EXPLORER_COUNT_CLASS}>{runs.length}</span>
      </div>
      <ul>
        {runs
          .filter(
            (run) => query.length === 0 || run.agent.includes(query) || run.id.includes(query),
          )
          .map((run) => (
            <li key={run.id}>
              <button
                type="button"
                className={EXPLORER_ROW_CLASS}
                data-slot="agent-run-row"
                data-status={run.status}
                data-selected={run.id === agentRunId ? "true" : "false"}
                onClick={() => onSelectRun(run.id === agentRunId ? null : run.id)}
              >
                <span className="min-w-0 flex-1 truncate">{run.agent}</span>
                <span className={EXPLORER_COUNT_CLASS}>{run.status}</span>
                <span className={EXPLORER_COUNT_CLASS} data-slot="agent-run-stop">
                  {run.stopReason ?? "—"}
                  {run.error ? ` · ${run.error}` : ""}
                </span>
                <span className={EXPLORER_COUNT_CLASS}>{run.steps}</span>
                <span className={EXPLORER_COUNT_CLASS}>{run.cost}</span>
                <span className={EXPLORER_COUNT_CLASS}>{tokenLabel(run)}</span>
                <span className="truncate font-mono text-[10px] text-muted-foreground">
                  {run.threadId ?? ""}
                </span>
              </button>
            </li>
          ))}
      </ul>
      {selected ? (
        <div data-slot="agent-run-detail">
          <div className={EXPLORER_STRIP_CLASS}>
            <span className={`${SECTION_HEAD_CLASS} px-2.5`}>{selected.agent}</span>
            <button
              type="button"
              className={`${SECTION_HEAD_CLASS} px-2.5`}
              data-slot="agent-run-follow"
              onClick={() => {
                setFollow([]);
                setFollowing(true);
              }}
            >
              Follow
            </button>
            <a href="#agent-approvals" className="px-2.5 text-xs underline">
              Approvals
            </a>
          </div>
          <ul>
            {selected.trail.map((step, index) => (
              <li
                key={`${step.tool}:${index}`}
                className={EXPLORER_ROW_CLASS}
                data-slot="agent-trail-step"
              >
                <span className="min-w-0 flex-1 truncate">{step.tool}</span>
                <span className={EXPLORER_COUNT_CLASS}>{step.status}</span>
                {step.approver ? (
                  <span className={EXPLORER_COUNT_CLASS} data-slot="agent-trail-approver">
                    {step.approver}
                  </span>
                ) : null}
                {step.denial ? (
                  <span className={EXPLORER_COUNT_CLASS}>{step.denial.reason}</span>
                ) : null}
              </li>
            ))}
          </ul>
          {selected.repairs.length > 0 ? (
            <ul>
              {selected.repairs.map((repair) => (
                <li
                  key={`${repair.prompt}:${repair.at}`}
                  className={EXPLORER_ROW_CLASS}
                  data-slot="agent-repair"
                >
                  <span className="min-w-0 flex-1 truncate">{repair.prompt}</span>
                  <span className={EXPLORER_COUNT_CLASS}>{repair.attempts}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {selected.children.length > 0 ? (
            <ul data-slot="agent-subagents">
              {selected.children.map((child) => (
                <li key={child.id}>
                  <button
                    type="button"
                    className={EXPLORER_ROW_CLASS}
                    data-parent={child.parentRunId ?? ""}
                    onClick={() => onSelectRun(child.id)}
                  >
                    <span className="min-w-0 flex-1 truncate">{child.agent}</span>
                    <span className={EXPLORER_COUNT_CLASS}>{child.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {following ? (
            <ul data-slot="agent-follow">
              {follow.map((line, index) => (
                <li key={index} className={EXPLORER_ROW_CLASS} data-slot="agent-follow-event">
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{line}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className={EXPLORER_STRIP_CLASS} id="agent-approvals">
        <span className={`${SECTION_HEAD_CLASS} px-2.5`}>Approvals</span>
      </div>
      {notice ? (
        <p className="px-2.5 py-1 text-xs" data-slot="approval-notice">
          {notice}
        </p>
      ) : null}
      <ul>
        {rows.map((row) => (
          <li key={row.id} className={EXPLORER_ROW_CLASS} data-slot="approval-row">
            <span className="min-w-0 flex-1 truncate">
              {row.agent} · {row.tool}
            </span>
            <span className={EXPLORER_COUNT_CLASS} data-slot="approval-tenant">
              {row.tenant ?? "—"}
            </span>
            <span className={EXPLORER_COUNT_CLASS} data-slot="approval-age">
              {formatAge(row.ageMs)}
            </span>
            <span className={EXPLORER_COUNT_CLASS}>{row.gate}</span>
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void approve(row);
              }}
            >
              <input
                aria-label="Edited args"
                value={argsText[row.id] ?? ""}
                placeholder={JSON.stringify(row.args)}
                onChange={(event) => {
                  const next = event.target.value;
                  setArgsText((current) => ({ ...current, [row.id]: next }));
                }}
              />
              <button type="submit">Approve</button>
            </form>
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void deny(row);
              }}
            >
              <input
                aria-label="Deny reason"
                value={reasons[row.id] ?? ""}
                onChange={(event) => {
                  const next = event.target.value;
                  setReasons((current) => ({ ...current, [row.id]: next }));
                }}
              />
              <button type="submit">Deny</button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
