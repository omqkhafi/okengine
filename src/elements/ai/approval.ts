/**
 * Durable human approval for one agent tool call.
 *
 * The pending row is a journal step. The first approve, deny, or timeout wins.
 */

import { fail } from "../../kernel/errors.ts";
import {
  hasJournalLease,
  JOURNAL_DEFAULT_LEASE_MS,
  type JournalEntry,
  type JournalRun,
  type JournalStore,
} from "../../kernel/journal.ts";
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
  /** Agent that requested the tool. Absent on rows written before this field. */
  readonly agent?: string;
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
  | { readonly ok: false; readonly status: 403 | 404 }
  | { readonly ok: false; readonly status: 409; readonly reason: "resolved" }
  | {
      readonly ok: false;
      readonly status: 409;
      readonly reason: "lease";
      readonly retryAfterSeconds: number;
    };

/**
 * HTTP 409 for a run whose lease is held. `Conflict` stays the finished case.
 *
 * @param retryAfterSeconds - Seconds until the lease expires
 */
export function journalLeaseBusyResponse(retryAfterSeconds: number): Response {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  const failure = fail("JournalLeaseBusy", { retryAfter: seconds });
  const headers = new Headers();
  headers.set("retry-after", String(seconds));
  return Response.json({ data: null, error: failure.error }, { status: 409, headers });
}

/**
 * Seconds a caller should wait before retrying a busy lease.
 *
 * @param expiresAt - Lease expiry epoch-ms, when the run has one
 * @param now - Clock used for the attempt
 */
export function leaseRetryAfterSeconds(expiresAt: number | undefined, now: number): number {
  if (expiresAt === undefined) return 1;
  return Math.max(1, Math.ceil((expiresAt - now) / 1000));
}

/**
 * Opaque approval id. The run id is the prefix so resolve can `get` one run.
 *
 * @param runId - Durable run id
 * @param toolCallId - Provider tool-call id, or a deterministic fallback
 */
export function approvalId(runId: string, toolCallId: string): string {
  return Buffer.from(`${runId}.${toolCallId}`, "utf8").toString("base64url");
}

/**
 * Split an opaque approval id. Run ids do not contain `.`.
 *
 * @param id - Approval id from the interrupt
 */
export function parseApprovalId(
  id: string,
): { readonly runId: string; readonly toolCallId: string } | undefined {
  let decoded: string;
  try {
    decoded = Buffer.from(id, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
  const dot = decoded.indexOf(".");
  if (dot <= 0 || dot === decoded.length - 1) return undefined;
  return { runId: decoded.slice(0, dot), toolCallId: decoded.slice(dot + 1) };
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
  const parsed = parseApprovalId(id);
  if (!parsed) return undefined;
  const run = await store.get(parsed.runId);
  if (!run) return undefined;
  const name = approvalStepName(id);
  const entry = run.entries.find((item) => item.kind === "step" && item.name === name);
  if (!entry || entry.kind !== "step") return undefined;
  return entry.value as AgentApprovalRecord;
}

/**
 * First writer wins. A later resolution returns 409.
 * Wakes a sleeping run by moving its sleep entry to now.
 *
 * @param store - Durable journal
 * @param id - Approval id
 * @param decision - Approve or deny
 * @param now - Clock used for the early wake
 * @param hold - Lease holder to renew instead of taking a new token. Timeout
 *   deny passes the resume holder's id so it does not drop that lease.
 */
export async function resolveAgentApproval(
  store: JournalStore,
  id: string,
  decision: AgentApprovalDecision,
  now: () => number = Date.now,
  hold?: string,
): Promise<AgentApprovalResolveResult> {
  const parsed = parseApprovalId(id);
  if (!parsed || !hasJournalLease(store)) return { ok: false, status: 404 };
  const name = approvalStepName(id);
  const token = hold ?? crypto.randomUUID();
  const at = now();
  const claimed = await store.acquireLease(parsed.runId, token, at, JOURNAL_DEFAULT_LEASE_MS);
  if (!claimed) {
    const held = await store.get(parsed.runId);
    return {
      ok: false,
      status: 409,
      reason: "lease",
      retryAfterSeconds: leaseRetryAfterSeconds(held?.leaseExpiresAt, at),
    };
  }
  try {
    const run = await store.get(parsed.runId);
    if (!run) return { ok: false, status: 404 };
    const entry = run.entries.find((item) => item.kind === "step" && item.name === name);
    if (!entry || entry.kind !== "step") return { ok: false, status: 404 };
    const current = entry.value as AgentApprovalRecord;
    if ((decision.tenant ?? null) !== (current.tenant ?? null)) {
      return { ok: false, status: 404 };
    }
    if (current.status !== "pending") return { ok: false, status: 409, reason: "resolved" };
    const next: AgentApprovalRecord = {
      ...current,
      status: decision.decision === "approve" ? "approved" : "denied",
      ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
      ...(decision.approver !== undefined ? { approver: decision.approver } : {}),
      ...(decision.args !== undefined ? { editedArgs: decision.args } : {}),
    };
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
      lockedBy: run.lockedBy,
      leaseExpiresAt: run.leaseExpiresAt,
    };
    await store.put(updated);
    return { ok: true };
  } finally {
    if (hold === undefined) await store.releaseLease(parsed.runId, token);
  }
}
