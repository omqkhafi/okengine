/**
 * Console projection for agent runs and the tool-approval queue.
 *
 * Numbers come from the agent ledger, the follow log, and the journal.
 * The UI must not recompute them.
 */

import type { AgentEventStore } from "../../kernel/agent-event-store.ts";
import type { JournalRun, JournalStore } from "../../kernel/journal.ts";
import {
  approvalStepName,
  parseApprovalId,
  type AgentApprovalRecord,
} from "../../elements/ai/approval.ts";
import type { AgUiEvent } from "../../elements/ai/events.ts";
import type { AgentRunHeader } from "../../elements/ai/run-events.ts";
import type {
  AgentDenial,
  AgentRunRecord,
  AgentStopReason,
  AgentToolEffect,
  AiJournalEntry,
  AiRuntime,
} from "../../elements/ai.ts";

/** Run lifecycle shown on the AI list. */
export type ConsoleAgentRunStatus = "running" | "finished" | "error" | "interrupted";

/** One tool line on a run. */
export interface ConsoleAgentTrailStep {
  readonly tool: string;
  readonly status: "ok" | "denied" | "pending";
  readonly effects: readonly AgentToolEffect[];
  readonly denial: AgentDenial | null;
  readonly approver?: string;
  readonly at: number;
}

/** One schema-repair follow-up that landed inside the run window. */
export interface ConsoleAgentRepair {
  readonly prompt: string;
  readonly at: number;
  readonly attempts: number;
}

/** Agent run row for the list and the subagent tree. */
export interface ConsoleAgentRunRow {
  readonly id: string;
  readonly agent: string;
  readonly status: ConsoleAgentRunStatus;
  readonly stopReason?: AgentStopReason;
  readonly error?: string;
  readonly steps: number;
  readonly cost: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly threadId?: string;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly parentRunId?: string;
  readonly tenant: string | null;
}

/** Run detail: trail, repairs, and direct children. */
export interface ConsoleAgentRunDetail extends ConsoleAgentRunRow {
  readonly message: string;
  readonly trail: readonly ConsoleAgentTrailStep[];
  readonly denials: readonly AgentDenial[];
  readonly repairs: readonly ConsoleAgentRepair[];
  readonly children: readonly ConsoleAgentRunRow[];
  readonly events: readonly { readonly seq: number; readonly event: AgUiEvent }[];
}

/** One pending tool approval. */
export interface ConsoleApprovalRow {
  readonly id: string;
  readonly agent: string;
  readonly tool: string;
  readonly args: unknown;
  readonly requestedAt: number;
  readonly ageMs: number;
  readonly gate: string;
  readonly tenant: string | null;
  readonly runId: string;
}

/** Sources for {@link loadConsoleAgentRuns}. */
export interface LoadAgentRunsInput {
  readonly runtime: AiRuntime | null;
  readonly store: JournalStore | null;
  readonly now: number;
  /** When set, drop rows from every other tenant. */
  readonly tenantId?: string | null;
}

/**
 * List agent runs from the in-memory ledger and the follow log.
 *
 * @param input - Runtime, journal, clock
 */
export async function loadConsoleAgentRuns(
  input: LoadAgentRunsInput,
): Promise<ConsoleAgentRunDetail[]> {
  const events = input.store?.agentEvents;
  const headers = events ? await events.listHeaders() : [];
  const records = new Map<string, AgentRunRecord>();
  for (const run of input.runtime?.agentRuns ?? []) records.set(run.id, run);
  const journal = input.runtime?.journal ?? [];
  const durable = await durableTrail(input.store);
  const details: ConsoleAgentRunDetail[] = [];
  const seen = new Set<string>();

  for (const header of headers) {
    seen.add(header.runId);
    const record = records.get(header.runId);
    const stored = await readEvents(events, header.runId);
    details.push(detailFrom(header, record, stored, journal, durable, input.tenantId));
  }
  for (const record of records.values()) {
    if (seen.has(record.id)) continue;
    details.push(detailFrom(undefined, record, [], journal, durable, input.tenantId));
  }

  const visible = details.filter((row) => row.id.length > 0);
  const byParent = new Map<string, ConsoleAgentRunRow[]>();
  for (const row of visible) {
    if (!row.parentRunId) continue;
    const list = byParent.get(row.parentRunId) ?? [];
    list.push(rowWithoutTree(row));
    byParent.set(row.parentRunId, list);
  }
  return visible
    .map((row) => ({ ...row, children: byParent.get(row.id) ?? [] }))
    .sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id));
}

/**
 * One run, or undefined when neither ledger has it.
 *
 * @param input - Sources
 * @param runId - Agent run id
 */
export async function loadConsoleAgentRun(
  input: LoadAgentRunsInput,
  runId: string,
): Promise<ConsoleAgentRunDetail | undefined> {
  const runs = await loadConsoleAgentRuns(input);
  return runs.find((row) => row.id === runId);
}

/**
 * Pending tool approvals, newest age first.
 *
 * @param store - Durable journal
 * @param now - Clock
 * @param tenantId - When set, keep only this tenant
 */
export async function loadApprovalQueue(
  store: JournalStore | null | undefined,
  now: number,
  tenantId?: string | null,
): Promise<ConsoleApprovalRow[]> {
  if (!store) return [];
  return projectApprovalQueue(await store.list(), now, tenantId);
}

/**
 * Pending `ai-approval:` steps.
 *
 * @param runs - Journal runs
 * @param now - Clock
 * @param tenantId - When set, keep only this tenant
 */
export function projectApprovalQueue(
  runs: readonly JournalRun[],
  now: number,
  tenantId?: string | null,
): ConsoleApprovalRow[] {
  const rows: ConsoleApprovalRow[] = [];
  for (const run of runs) {
    for (const entry of run.entries) {
      if (entry.kind !== "step" || !entry.name.startsWith("ai-approval:")) continue;
      const id = entry.name.slice("ai-approval:".length);
      const value = entry.value as AgentApprovalRecord;
      if (value.status !== "pending") continue;
      if (tenantId !== undefined && tenantId !== null && (value.tenant ?? null) !== tenantId) {
        continue;
      }
      const parsed = parseApprovalId(id);
      const requestedAt = value.requestedAt ?? entry.at;
      rows.push({
        id,
        agent: value.agent ?? run.flow,
        tool: value.tool,
        args: value.args,
        requestedAt,
        ageMs: Math.max(0, now - requestedAt),
        gate: value.gate,
        tenant: value.tenant ?? null,
        runId: parsed?.runId ?? run.id,
      });
    }
  }
  return rows.sort((a, b) => b.ageMs - a.ageMs || a.id.localeCompare(b.id));
}

/**
 * Step name helper re-exported for tests that seed a journal row.
 *
 * @param id - Approval id
 */
export function approvalStep(id: string): string {
  return approvalStepName(id);
}

function rowWithoutTree(row: ConsoleAgentRunDetail): ConsoleAgentRunRow {
  return {
    id: row.id,
    agent: row.agent,
    status: row.status,
    ...(row.stopReason !== undefined ? { stopReason: row.stopReason } : {}),
    ...(row.error !== undefined ? { error: row.error } : {}),
    steps: row.steps,
    cost: row.cost,
    ...(row.inputTokens !== undefined ? { inputTokens: row.inputTokens } : {}),
    ...(row.outputTokens !== undefined ? { outputTokens: row.outputTokens } : {}),
    ...(row.threadId !== undefined ? { threadId: row.threadId } : {}),
    startedAt: row.startedAt,
    ...(row.finishedAt !== undefined ? { finishedAt: row.finishedAt } : {}),
    ...(row.parentRunId !== undefined ? { parentRunId: row.parentRunId } : {}),
    tenant: row.tenant,
  };
}

async function readEvents(
  events: AgentEventStore | undefined,
  runId: string,
): Promise<readonly { readonly seq: number; readonly event: AgUiEvent }[]> {
  if (!events) return [];
  const rows = await events.readAfter(runId, 0);
  return rows.map((row) => ({ seq: row.seq, event: row.event as AgUiEvent }));
}

/** One journal approval, addressed by its opaque id and by the tool call. */
interface DurableApproval {
  readonly id: string;
  /** Journal run that owns the step. This is the Flow run, not always the agent run. */
  readonly journalRunId: string;
  readonly agent?: string;
  readonly toolCallId: string;
  readonly step: ConsoleAgentTrailStep;
}

/** Agent name and tool lines recovered from journal approval steps. */
interface DurableTrail {
  readonly agentByRun: ReadonlyMap<string, string>;
  readonly stepsByRun: ReadonlyMap<string, readonly ConsoleAgentTrailStep[]>;
  readonly byApprovalId: ReadonlyMap<string, DurableApproval>;
}

/**
 * Approval steps are the durable trail when the in-memory ledger is on another runtime.
 *
 * @param store - Shared journal
 */
async function durableTrail(store: JournalStore | null): Promise<DurableTrail> {
  const agentByRun = new Map<string, string>();
  const stepsByRun = new Map<string, ConsoleAgentTrailStep[]>();
  const byApprovalId = new Map<string, DurableApproval>();
  if (!store) return { agentByRun, stepsByRun, byApprovalId };
  for (const run of await store.list()) {
    for (const entry of run.entries) {
      if (entry.kind !== "step" || !entry.name.startsWith("ai-approval:")) continue;
      const id = entry.name.slice("ai-approval:".length);
      const parsed = parseApprovalId(id);
      if (!parsed) continue;
      const value = entry.value as AgentApprovalRecord;
      if (value.agent) agentByRun.set(parsed.runId, value.agent);
      const denied = value.status === "denied";
      const step: ConsoleAgentTrailStep = {
        tool: value.tool,
        status: denied ? "denied" : value.status === "approved" ? "ok" : "pending",
        effects: [],
        denial: denied
          ? {
              agent: value.agent ?? "",
              tool: value.tool,
              gate: value.gate,
              reason: value.reason ?? "",
              at: entry.at,
            }
          : null,
        ...(value.approver !== undefined ? { approver: value.approver } : {}),
        at: value.requestedAt ?? entry.at,
      };
      const list = stepsByRun.get(parsed.runId) ?? [];
      list.push(step);
      stepsByRun.set(parsed.runId, list);
      byApprovalId.set(id, {
        id,
        journalRunId: parsed.runId,
        ...(value.agent !== undefined ? { agent: value.agent } : {}),
        toolCallId: parsed.toolCallId,
        step,
      });
    }
  }
  return { agentByRun, stepsByRun, byApprovalId };
}

function detailFrom(
  header: AgentRunHeader | undefined,
  record: AgentRunRecord | undefined,
  events: readonly { readonly seq: number; readonly event: AgUiEvent }[],
  journal: readonly AiJournalEntry[],
  durable: DurableTrail,
  tenantId: string | null | undefined,
): ConsoleAgentRunDetail {
  const finished = events.findLast(
    (row) => row.event.type === "RUN_FINISHED" && row.event.outcome?.type !== "interrupt",
  );
  const interrupted = events.some(
    (row) => row.event.type === "RUN_FINISHED" && row.event.outcome?.type === "interrupt",
  );
  const errored = events.findLast((row) => row.event.type === "RUN_ERROR");
  const usage = finished?.event.type === "RUN_FINISHED" ? finished.event.usage?.[0] : undefined;
  const result = finished?.event.type === "RUN_FINISHED" ? finished.event.result : undefined;
  const stopReason = record?.stopReason ?? stopFrom(result?.stopReason);
  const error =
    record?.error ??
    (result && "error" in result && typeof result.error === "string" ? result.error : undefined) ??
    (errored?.event.type === "RUN_ERROR" ? errored.event.message : undefined);
  const startedAt = header?.openedAt ?? record?.at ?? 0;
  const finishedAt = header?.finishedAt ?? record?.finishedAt;
  const tenant = header?.tenant ?? null;
  const status = runStatus({
    stopReason,
    error,
    finishedAt,
    interrupted: interrupted && finished === undefined,
  });
  const inputTokens = record?.inputTokens ?? usage?.inputTokens;
  const outputTokens = record?.outputTokens ?? usage?.outputTokens;
  const id = header?.runId ?? record?.id ?? "";
  const trail = trailFor(id, record, events, durable);
  const parentRunId = header?.parentRunId ?? record?.parentRunId ?? parentFromEvents(events);
  const row: ConsoleAgentRunDetail = {
    id,
    agent:
      header?.agent ??
      record?.agent ??
      agentFromApprovals(id, events, durable) ??
      agentFromEvents(events) ??
      "(unknown)",
    status,
    ...(stopReason !== undefined ? { stopReason } : {}),
    ...(error !== undefined ? { error } : {}),
    steps: record?.steps ?? (countSteps(events) || trail.length),
    cost: record?.cost ?? result?.cost ?? 0,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...((header?.threadId ?? record?.threadId) !== undefined
      ? { threadId: header?.threadId ?? record?.threadId }
      : {}),
    startedAt,
    ...(finishedAt !== undefined ? { finishedAt } : {}),
    ...(parentRunId !== undefined ? { parentRunId } : {}),
    tenant,
    message: record?.message ?? "",
    trail,
    denials: record?.denials ?? trail.flatMap((step) => (step.denial ? [step.denial] : [])),
    repairs: repairsInWindow(journal, startedAt, finishedAt),
    children: [],
    events,
  };
  if (tenantId !== undefined && tenantId !== null && row.tenant !== tenantId) {
    return { ...row, id: "" };
  }
  return row;
}

function runStatus(input: {
  readonly stopReason?: AgentStopReason;
  readonly error?: string;
  readonly finishedAt?: number;
  readonly interrupted: boolean;
}): ConsoleAgentRunStatus {
  if (input.stopReason === "error") return "error";
  if (input.error !== undefined && input.finishedAt === undefined && !input.interrupted)
    return "error";
  if (input.interrupted) return "interrupted";
  if (input.finishedAt === undefined && input.stopReason === undefined) return "running";
  return "finished";
}

function stopFrom(value: string | undefined): AgentStopReason | undefined {
  if (
    value === "completed" ||
    value === "max_steps" ||
    value === "budget" ||
    value === "denied" ||
    value === "aborted" ||
    value === "error"
  ) {
    return value;
  }
  return undefined;
}

function parentFromEvents(events: readonly { readonly event: AgUiEvent }[]): string | undefined {
  for (const row of events) {
    if (row.event.type !== "CUSTOM") continue;
    const value = row.event.value;
    if (!value || typeof value !== "object" || !("parentRunId" in value)) continue;
    const parent = (value as { parentRunId?: unknown }).parentRunId;
    if (typeof parent === "string") return parent;
  }
  return undefined;
}

function agentFromEvents(events: readonly { readonly event: AgUiEvent }[]): string | undefined {
  for (const row of events) {
    if (row.event.type === "CUSTOM" && row.event.name === "oke.subagent.started") {
      const value = row.event.value;
      if (value && typeof value === "object" && "agent" in value) {
        const agent = (value as { agent?: unknown }).agent;
        if (typeof agent === "string") return agent;
      }
    }
  }
  return undefined;
}

function countSteps(events: readonly { readonly event: AgUiEvent }[]): number {
  const started = events.filter((row) => row.event.type === "STEP_STARTED").length;
  const finished = events.filter((row) => row.event.type === "STEP_FINISHED").length;
  return Math.max(started, finished);
}

/**
 * Tool lines for one agent run.
 *
 * The in-memory ledger wins. Otherwise the follow log's tool calls are joined
 * to journal approvals by the interrupt id. The approval's journal run id is
 * the Flow run, so it only matches the agent run id when they are the same.
 *
 * @param id - Agent run id
 * @param record - In-memory ledger row
 * @param events - Follow-log rows
 * @param durable - Journal approvals
 */
function trailFor(
  id: string,
  record: AgentRunRecord | undefined,
  events: readonly { readonly event: AgUiEvent }[],
  durable: DurableTrail,
): ConsoleAgentTrailStep[] {
  const recorded = record?.trail ?? [];
  if (recorded.length > 0) {
    return recorded.map((step) => ({
      tool: step.tool,
      status: step.status,
      effects: step.effects,
      denial: step.denial ?? null,
      ...(step.approver !== undefined ? { approver: step.approver } : {}),
      at: step.at,
    }));
  }
  const linked = approvalsForRun(id, events, durable);
  const steps: ConsoleAgentTrailStep[] = [];
  const seen = new Set<string>();
  for (const row of events) {
    if (row.event.type !== "TOOL_CALL_START") continue;
    const toolCallId = row.event.toolCallId;
    seen.add(toolCallId);
    const approval = linked.get(toolCallId);
    const resulted = events.some((stored) => {
      const body = stored.event;
      return body.type === "TOOL_CALL_RESULT" && body.toolCallId === toolCallId;
    });
    if (approval) {
      steps.push(
        resulted && approval.step.status === "pending"
          ? { ...approval.step, status: "ok" }
          : approval.step,
      );
      continue;
    }
    steps.push({
      tool: row.event.toolCallName,
      status: resulted ? "ok" : "pending",
      effects: [],
      denial: null,
      at: 0,
    });
  }
  for (const approval of linked.values()) {
    if (seen.has(approval.toolCallId)) continue;
    steps.push(approval.step);
  }
  if (steps.length > 0) return steps;
  return [...(durable.stepsByRun.get(id) ?? [])];
}

/**
 * Approvals whose interrupt is on this follow log, or whose journal run id is this agent run.
 *
 * @param id - Agent run id
 * @param events - Follow-log rows
 * @param durable - Journal approvals
 */
function approvalsForRun(
  id: string,
  events: readonly { readonly event: AgUiEvent }[],
  durable: DurableTrail,
): Map<string, DurableApproval> {
  const linked = new Map<string, DurableApproval>();
  for (const approval of durable.byApprovalId.values()) {
    if (approval.journalRunId === id) linked.set(approval.toolCallId, approval);
  }
  for (const row of events) {
    if (row.event.type !== "RUN_FINISHED" || row.event.outcome?.type !== "interrupt") continue;
    for (const interrupt of row.event.outcome.interrupts) {
      const approval = durable.byApprovalId.get(interrupt.id);
      if (approval) linked.set(approval.toolCallId, approval);
    }
  }
  return linked;
}

/**
 * Agent name from an approval that belongs to this run.
 *
 * @param id - Agent run id
 * @param events - Follow-log rows
 * @param durable - Journal approvals
 */
function agentFromApprovals(
  id: string,
  events: readonly { readonly event: AgUiEvent }[],
  durable: DurableTrail,
): string | undefined {
  for (const approval of approvalsForRun(id, events, durable).values()) {
    if (approval.agent) return approval.agent;
  }
  return durable.agentByRun.get(id);
}

function repairsInWindow(
  journal: readonly AiJournalEntry[],
  startedAt: number,
  finishedAt: number | undefined,
): ConsoleAgentRepair[] {
  const end = finishedAt ?? Number.POSITIVE_INFINITY;
  const repairs: ConsoleAgentRepair[] = [];
  for (const entry of journal) {
    if (entry.attempts.length < 2) continue;
    if (entry.at < startedAt || entry.at > end) continue;
    repairs.push({ prompt: entry.prompt, at: entry.at, attempts: entry.attempts.length });
  }
  return repairs;
}
