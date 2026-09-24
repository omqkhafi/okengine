/**
 * Durable human approval for one agent tool call.
 *
 * The pending row is a journal step. The first approve, deny, or timeout wins.
 */

import type { JournalEntry, JournalRun, JournalStore } from "../../kernel/journal.ts";
import { parseDurationMs } from "../clock/duration.ts";

/** Default wait before an unanswered approval is denied. */
export const AI_APPROVAL_TIMEOUT = "24h";

/** Thrown when an approval tool runs on a Flow that is not durable. */
export class AiDurableRequiredError extends Error {
  /**
   * @param flow - Calling flow name
   * @param agent - Agent name
   */
  constructor(flow: string, agent: string) {
    super(`ai: flow "${flow}" must set durable: true to run agent "${agent}"`);
    this.name = "AiDurableRequiredError";
  }
}

/** Persisted approval decision. */
export interface AgentApprovalRecord {
  status: "pending" | "approved" | "denied";
  readonly tool: string;
  readonly args: unknown;
  readonly gate: string;
  readonly tenant: string | null;
  readonly requestedAt: number;
  reason?: string;
  approver?: string;
  editedArgs?: unknown;
}

/** How a caller resolves a pending approval. */
export interface AgentApprovalDecision {
  readonly decision: "approve" | "deny";
  readonly args?: unknown;
  readonly reason?: string;
  readonly approver?: string;
  readonly tenant?: string | null;
}

/** Result of resolving one approval. */
export type AgentApprovalResolveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: 403 | 404 | 409 };

const chains = new Map<string, Promise<unknown>>();

/**
 * Run `fn` after any in-flight resolution of the same id.
 *
 * @param id - Approval id
 * @param fn - Critical section
 */
function exclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(id) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  chains.set(
    id,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/**
 * Milliseconds for a tool timeout. `24h` when omitted or unparseable.
 *
 * @param timeout - Duration string
 */
export function approvalTimeoutMs(timeout: string | undefined): number {
  const parsed = parseDurationMs(timeout ?? AI_APPROVAL_TIMEOUT);
  return parsed > 0 ? parsed : parseDurationMs(AI_APPROVAL_TIMEOUT);
}

/**
 * Journal step name for one approval.
 *
 * @param id - Approval id
 */
export function approvalStepName(id: string): string {
  return `ai-approval:${id}`;
}

/**
 * Read one approval from the journal store.
 *
 * @param store - Durable journal
 * @param id - Approval id
 */
export async function readAgentApproval(
  store: JournalStore,
  id: string,
): Promise<AgentApprovalRecord | undefined> {
  const name = approvalStepName(id);
  const runs = await store.list();
  for (const run of runs) {
    for (const entry of run.entries) {
      if (entry.kind === "step" && entry.name === name) {
        return entry.value as AgentApprovalRecord;
      }
    }
  }
  return undefined;
}

/**
 * First writer wins. A later resolution returns 409.
 * Wakes a sleeping run by moving its sleep entry to now.
 *
 * @param store - Durable journal
 * @param id - Approval id
 * @param decision - Approve or deny
 * @param now - Clock used for the early wake
 */
export async function resolveAgentApproval(
  store: JournalStore,
  id: string,
  decision: AgentApprovalDecision,
  now: () => number = Date.now,
): Promise<AgentApprovalResolveResult> {
  return exclusive(id, async () => {
    const name = approvalStepName(id);
    const runs = await store.list();
    const run = runs.find((candidate) =>
      candidate.entries.some((entry) => entry.kind === "step" && entry.name === name),
    );
    if (!run) return { ok: false, status: 404 };
    const entry = run.entries.find((item) => item.kind === "step" && item.name === name);
    if (!entry || entry.kind !== "step") return { ok: false, status: 404 };
    const current = entry.value as AgentApprovalRecord;
    if ((decision.tenant ?? null) !== (current.tenant ?? null)) {
      return { ok: false, status: 404 };
    }
    if (current.status !== "pending") return { ok: false, status: 409 };
    const next: AgentApprovalRecord = {
      ...current,
      status: decision.decision === "approve" ? "approved" : "denied",
      ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
      ...(decision.approver !== undefined ? { approver: decision.approver } : {}),
      ...(decision.args !== undefined ? { editedArgs: decision.args } : {}),
    };
    const at = now();
    const entries: JournalEntry[] = run.entries.map((item) => {
      if (item.kind === "step" && item.name === name) return { ...item, value: next };
      if (item.kind === "sleep" && item.label === name) return { ...item, wakeAt: at };
      return item;
    });
    const updated: JournalRun = {
      ...run,
      entries,
      wakeAt: at,
      status: run.status === "sleeping" ? "sleeping" : run.status,
    };
    await store.put(updated);
    return { ok: true };
  });
}
