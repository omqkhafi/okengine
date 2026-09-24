/**
 * Console projection for decisions: lockfile state and the review queue.
 */

import type { JournalRun, JournalStore } from "../../kernel/journal.ts";
import type { Manifest } from "../../manifest/types.ts";
import { aiDecisionRegistry } from "../../kernel/element-registries.ts";
import {
  decisionDriftSuspended,
  getDecisionLock,
  type DecisionCandidate,
  type DecisionLockfile,
} from "../../elements/ai/decisions/certificate.ts";

/** List state for one decision. */
export type DecisionListState = "learning" | "candidate" | "certified" | "suspended";

/** One decision row. */
export interface DecisionListRow {
  readonly name: string;
  readonly state: DecisionListState;
  readonly mode: "review" | "abstain";
  readonly model?: string;
  /** Candidate fit, when one is stored and the decision is not certified. */
  readonly metrics?: Readonly<Record<string, number>>;
  /** Command that writes this decision's candidate into the lockfile. */
  readonly promote?: string;
}

/** One question the resolve form can answer. */
export interface DecisionFormQuestion {
  readonly id: string;
  readonly kind: "boolean" | "choice" | "score";
  readonly options?: readonly string[];
  readonly levels?: readonly string[];
}

/** One parked or audit review. */
export interface DecisionQueueRow {
  readonly id: string;
  readonly decision: string;
  readonly requestedAt: number;
  readonly ageMs: number;
  readonly labelOnly: boolean;
  readonly status: "pending" | "reviewed";
  readonly questions: readonly DecisionFormQuestion[];
}

/**
 * List state from the lockfile, the candidate, and the app drift flag.
 *
 * @param manifest - App manifest
 * @param lock - Lockfile, when one is loaded
 */
export function projectDecisionList(
  manifest: Manifest | null | undefined,
  lock: DecisionLockfile | undefined = getDecisionLock(),
  candidates: ReadonlySet<string> = new Set(),
  metrics: Readonly<Record<string, Readonly<Record<string, number>>>> = {},
): DecisionListRow[] {
  const decisions = manifest?.ai?.decisions ?? {};
  return Object.entries(decisions).map(([name, decision]) => {
    const certified = lock?.decisions[name] !== undefined;
    const candidate = candidates.has(name);
    const suspended = decisionDriftSuspended(name);
    const state: DecisionListState = suspended
      ? "suspended"
      : certified
        ? "certified"
        : candidate
          ? "candidate"
          : "learning";
    const fitted = metrics[name];
    return {
      name,
      state,
      mode: decision.mode,
      ...(decision.model !== undefined ? { model: decision.model } : {}),
      ...(state === "candidate" && fitted ? { metrics: fitted } : {}),
      ...(state === "candidate" ? { promote: `oke decide promote ${name}` } : {}),
    };
  });
}

/**
 * First slice metrics on a stored candidate.
 *
 * @param entry - Candidate body
 */
export function candidateMetrics(
  entry: DecisionCandidate | undefined,
): Record<string, number> | undefined {
  if (!entry) return undefined;
  for (const slices of Object.values(entry.questions)) {
    for (const slice of Object.values(slices)) {
      if (slice.metrics) return { ...slice.metrics };
    }
  }
  return undefined;
}

/**
 * Pending and reviewed decision steps, newest age first.
 *
 * @param runs - Journal runs
 * @param now - Clock
 */
export function projectDecisionQueue(
  runs: readonly JournalRun[],
  now: number,
  tenantId?: string | null,
): DecisionQueueRow[] {
  const rows: DecisionQueueRow[] = [];
  for (const run of runs) {
    for (const entry of run.entries) {
      if (entry.kind !== "step") continue;
      const labelOnly = entry.name.startsWith("ai-decision-label:");
      const parked = entry.name.startsWith("ai-decision:");
      if (!labelOnly && !parked) continue;
      const id = entry.name.slice(labelOnly ? "ai-decision-label:".length : "ai-decision:".length);
      const value = entry.value as {
        status?: "pending" | "reviewed";
        requestedAt?: number;
        tenant?: string | null;
        open?: readonly string[];
      };
      if (tenantId !== undefined && (value.tenant ?? null) !== tenantId) continue;
      const requestedAt = value.requestedAt ?? entry.at;
      rows.push({
        id,
        decision: decisionNameFromId(id),
        requestedAt,
        ageMs: Math.max(0, now - requestedAt),
        labelOnly,
        status: value.status ?? "pending",
        questions: formQuestions(decisionNameFromId(id), value.open),
      });
    }
  }
  return rows.sort((a, b) => b.ageMs - a.ageMs);
}

/**
 * Queue from a journal store.
 *
 * @param store - Durable journal, when the console has one
 * @param now - Clock
 */
export async function loadDecisionQueue(
  store: JournalStore | null | undefined,
  now: number,
  tenantId?: string | null,
): Promise<DecisionQueueRow[]> {
  if (!store) return [];
  return projectDecisionQueue(await store.list(), now, tenantId);
}

function decisionNameFromId(id: string): string {
  try {
    const decoded = Buffer.from(id, "base64url").toString("utf8");
    const first = decoded.indexOf(".");
    const second = first >= 0 ? decoded.indexOf(".", first + 1) : -1;
    if (second > first) return decoded.slice(second + 1);
    return first > 0 ? decoded.slice(first + 1) : id;
  } catch {
    return id;
  }
}

function formQuestions(name: string, open: readonly string[] | undefined): DecisionFormQuestion[] {
  const decl = aiDecisionRegistry.find((item) => item.name === name);
  if (!decl) return [];
  const ids = open && open.length > 0 ? open : Object.keys(decl.ask);
  const questions: DecisionFormQuestion[] = [];
  for (const id of ids) {
    const question = decl.ask[id];
    if (!question) continue;
    if (question.kind === "choice") {
      questions.push({
        id,
        kind: "choice",
        options: [...Object.keys(question.options), "none_of_these"],
      });
    } else if (question.kind === "score") {
      questions.push({ id, kind: "score", levels: [...question.levels] });
    } else {
      questions.push({ id, kind: "boolean" });
    }
  }
  return questions;
}
