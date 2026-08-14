/**
 * Lived-in keel Store rows for Console ui-next seed.
 *
 * Workspace ENG / DES / SUP — teams, cycles, issues, comments, documents,
 * plus KV drafts, file attachments, and semantic issue index.
 */

import { defineTable } from "../../elements/store.ts";
import { classify } from "../../elements/store/classify.ts";
import {
  UI_NEXT_SEED_APP_SYSTEM_ROWS,
  UI_NEXT_SEED_APP_SYSTEM_TABLES,
} from "./ui-next-seed-app-schema.ts";
import type { SqlStoreHandle } from "../../elements/store/sql-session.ts";
import type {
  FilesStoreFxHandle,
  KvStoreFxHandle,
  StoreRuntime,
  VectorIndexStoreFxHandle,
} from "../../elements/store/runtime.ts";

/** Extra generated volume on top of the featured Linear story rows. */
const GENERATED = {
  members: 12,
  projects: 6,
  cycles: 4,
  issues: 500,
  issueLabels: 520,
  comments: 220,
  documents: 20,
  customerRequests: 30,
  kvKeys: 40,
  files: 24,
  index: 44,
} as const;

const SEED_TEAMS = [
  { id: "team_eng", key: "ENG", name: "Engineering", parent_id: null as string | null },
  { id: "team_des", key: "DES", name: "Design", parent_id: "team_eng" },
  { id: "team_sup", key: "SUP", name: "Support", parent_id: null },
] as const;

const SEED_MEMBERS = [
  { id: "mem_aria", team_id: "team_eng", name: "Aria Chen", email: "aria@keel.dev", role: "admin" },
  {
    id: "mem_ben",
    team_id: "team_eng",
    name: "Ben Okonkwo",
    email: "ben@keel.dev",
    role: "member",
  },
  { id: "mem_cai", team_id: "team_des", name: "Cai Moreno", email: "cai@keel.dev", role: "member" },
  { id: "mem_dia", team_id: "team_sup", name: "Dia Farouk", email: "dia@keel.dev", role: "member" },
  { id: "mem_eli", team_id: "team_eng", name: "Eli Park", email: "eli@keel.dev", role: "member" },
] as const;

const SEED_STATES = [
  { id: "st_eng_triage", team_id: "team_eng", name: "Triage", type: "triage", position: 0 },
  { id: "st_eng_backlog", team_id: "team_eng", name: "Backlog", type: "backlog", position: 1 },
  { id: "st_eng_todo", team_id: "team_eng", name: "Todo", type: "unstarted", position: 2 },
  { id: "st_eng_progress", team_id: "team_eng", name: "In Progress", type: "started", position: 3 },
  { id: "st_eng_review", team_id: "team_eng", name: "In Review", type: "started", position: 4 },
  { id: "st_eng_done", team_id: "team_eng", name: "Done", type: "completed", position: 5 },
  { id: "st_eng_canceled", team_id: "team_eng", name: "Canceled", type: "canceled", position: 6 },
  { id: "st_eng_dup", team_id: "team_eng", name: "Duplicate", type: "canceled", position: 7 },
  { id: "st_sup_triage", team_id: "team_sup", name: "Triage", type: "triage", position: 0 },
  { id: "st_sup_todo", team_id: "team_sup", name: "Todo", type: "unstarted", position: 1 },
  { id: "st_sup_done", team_id: "team_sup", name: "Done", type: "completed", position: 2 },
] as const;

const SEED_LABELS = [
  { id: "lab_bug", team_id: null as string | null, name: "bug", group_name: "type" },
  { id: "lab_feature", team_id: null, name: "feature", group_name: "type" },
  { id: "lab_frontend", team_id: "team_eng", name: "frontend", group_name: "area" },
  { id: "lab_regression", team_id: "team_eng", name: "regression", group_name: "type" },
  { id: "lab_customer", team_id: "team_sup", name: "customer", group_name: "source" },
  { id: "lab_design", team_id: "team_des", name: "design", group_name: "area" },
] as const;

const SEED_INITIATIVES = [
  {
    id: "init_console",
    name: "Ship Console Next",
    status: "active",
    owner_email: "aria@keel.dev",
    target_date: "2026-09-30",
  },
] as const;

const SEED_PROJECTS = [
  {
    id: "proj_traces",
    initiative_id: "init_console",
    name: "Traces pane",
    status: "started",
    lead_email: "aria@keel.dev",
    target_date: "2026-08-29",
    progress: 62,
  },
  {
    id: "proj_store",
    initiative_id: "init_console",
    name: "Store grid",
    status: "started",
    lead_email: "ben@keel.dev",
    target_date: "2026-09-12",
    progress: 41,
  },
] as const;

const SEED_MILESTONES = [
  {
    id: "ms_alpha",
    project_id: "proj_traces",
    name: "Alpha",
    target_date: "2026-08-15",
    sort_order: 1,
  },
  {
    id: "ms_beta",
    project_id: "proj_traces",
    name: "Beta",
    target_date: "2026-08-29",
    sort_order: 2,
  },
  {
    id: "ms_store_ga",
    project_id: "proj_store",
    name: "GA",
    target_date: "2026-09-12",
    sort_order: 1,
  },
] as const;

const SEED_UPDATES = [
  {
    id: "upd_traces_1",
    project_id: "proj_traces",
    health: "on_track",
    body: "Chain highlight + waterfall tip landed. Beta is the remaining risk.",
    author_email: "aria@keel.dev",
  },
  {
    id: "upd_store_1",
    project_id: "proj_store",
    health: "at_risk",
    body: "Pending-edits sheet slipped; RTL cell polish still open.",
    author_email: "ben@keel.dev",
  },
] as const;

const SEED_CYCLES = [
  {
    id: "cyc_24",
    team_id: "team_eng",
    number: 24,
    name: "Cycle 24",
    starts_at: "2026-07-13T00:00:00Z",
    ends_at: "2026-07-26T23:59:59Z",
    state: "completed",
  },
  {
    id: "cyc_25",
    team_id: "team_eng",
    number: 25,
    name: "Cycle 25",
    starts_at: "2026-07-27T00:00:00Z",
    ends_at: "2026-08-09T23:59:59Z",
    state: "active",
  },
  {
    id: "cyc_26",
    team_id: "team_eng",
    number: 26,
    name: "Cycle 26",
    starts_at: "2026-08-10T00:00:00Z",
    ends_at: "2026-08-23T23:59:59Z",
    state: "upcoming",
  },
] as const;

const SEED_ISSUES = [
  {
    id: "iss_eng_184",
    identifier: "ENG-184",
    title: "Pulse graph on selected trace",
    description: "Highlight the github → create → notify chain when a Traces row is selected.",
    priority: 2,
    estimate: 5,
    state_id: "st_eng_progress",
    team_id: "team_eng",
    project_id: "proj_traces",
    milestone_id: "ms_beta",
    cycle_id: "cyc_25",
    parent_id: null as string | null,
    assignee_email: "aria@keel.dev",
    creator_email: "ben@keel.dev",
    due_date: "2026-08-08",
    sla_breaches_at: null as string | null,
    triaged_at: "2026-07-28T09:12:00Z",
    archived_at: null as string | null,
  },
  {
    id: "iss_eng_185",
    identifier: "ENG-185",
    title: "Waterfall tooltip copy",
    description: "Kind · resource · duration · +offset on hover.",
    priority: 2,
    estimate: 2,
    state_id: "st_eng_todo",
    team_id: "team_eng",
    project_id: "proj_traces",
    milestone_id: "ms_beta",
    cycle_id: "cyc_25",
    parent_id: "iss_eng_184",
    assignee_email: "eli@keel.dev",
    creator_email: "aria@keel.dev",
    due_date: null,
    sla_breaches_at: null,
    triaged_at: "2026-07-29T11:00:00Z",
    archived_at: null,
  },
  {
    id: "iss_eng_186",
    identifier: "ENG-186",
    title: "Store grid range select",
    description: "Shift-click cell range + pending edits sheet.",
    priority: 3,
    estimate: 8,
    state_id: "st_eng_progress",
    team_id: "team_eng",
    project_id: "proj_store",
    milestone_id: "ms_store_ga",
    cycle_id: "cyc_25",
    parent_id: null,
    assignee_email: "ben@keel.dev",
    creator_email: "aria@keel.dev",
    due_date: "2026-08-12",
    sla_breaches_at: null,
    triaged_at: "2026-07-27T08:00:00Z",
    archived_at: null,
  },
  {
    id: "iss_eng_170",
    identifier: "ENG-170",
    title: "Traces pane skeleton",
    description: "Shipped in cycle 24.",
    priority: 3,
    estimate: 5,
    state_id: "st_eng_done",
    team_id: "team_eng",
    project_id: "proj_traces",
    milestone_id: "ms_alpha",
    cycle_id: "cyc_24",
    parent_id: null,
    assignee_email: "aria@keel.dev",
    creator_email: "aria@keel.dev",
    due_date: null,
    sla_breaches_at: null,
    triaged_at: "2026-07-14T10:00:00Z",
    archived_at: null,
  },
  {
    id: "iss_eng_171",
    identifier: "ENG-171",
    title: "Legacy runs CSV export",
    description: "Won't fix — use Copy run ID.",
    priority: 4,
    estimate: null as number | null,
    state_id: "st_eng_canceled",
    team_id: "team_eng",
    project_id: null as string | null,
    milestone_id: null as string | null,
    cycle_id: "cyc_24",
    parent_id: null,
    assignee_email: null as string | null,
    creator_email: "eli@keel.dev",
    due_date: null,
    sla_breaches_at: null,
    triaged_at: "2026-07-15T12:00:00Z",
    archived_at: null,
  },
  {
    id: "iss_eng_190",
    identifier: "ENG-190",
    title: "Dimension query presets",
    description: "Save Advanced filter chips as views — later.",
    priority: 4,
    estimate: 3,
    state_id: "st_eng_backlog",
    team_id: "team_eng",
    project_id: "proj_traces",
    milestone_id: null,
    cycle_id: null,
    parent_id: null,
    assignee_email: null,
    creator_email: "ben@keel.dev",
    due_date: null,
    sla_breaches_at: null,
    triaged_at: null,
    archived_at: null,
  },
  {
    id: "iss_des_22",
    identifier: "DES-22",
    title: "RTL cell polish",
    description: "ملاحظة التصميم — mixed LTR identifiers in RTL notes.",
    priority: 3,
    estimate: 3,
    state_id: "st_eng_todo",
    team_id: "team_des",
    project_id: "proj_store",
    milestone_id: "ms_store_ga",
    cycle_id: "cyc_25",
    parent_id: null,
    assignee_email: "cai@keel.dev",
    creator_email: "cai@keel.dev",
    due_date: "2026-08-10",
    sla_breaches_at: null,
    triaged_at: "2026-07-30T14:00:00Z",
    archived_at: null,
  },
  {
    id: "iss_sup_12",
    identifier: "SUP-12",
    title: "Customer cannot sign in",
    description: "Asks intake — session cleared after claim.",
    priority: 1,
    estimate: 2,
    state_id: "st_sup_triage",
    team_id: "team_sup",
    project_id: null,
    milestone_id: null,
    cycle_id: null,
    parent_id: null,
    assignee_email: "dia@keel.dev",
    creator_email: "dia@keel.dev",
    due_date: "2026-08-06",
    sla_breaches_at: "2026-08-05T18:00:00Z",
    triaged_at: null,
    archived_at: null,
  },
  {
    id: "iss_sup_13",
    identifier: "SUP-13",
    title: "Replica lag banner missing",
    description: "Support saw stale SQL rows; SLA already breached.",
    priority: 1,
    estimate: 3,
    state_id: "st_sup_todo",
    team_id: "team_sup",
    project_id: "proj_store",
    milestone_id: null,
    cycle_id: null,
    parent_id: null,
    assignee_email: "dia@keel.dev",
    creator_email: "eli@keel.dev",
    due_date: "2026-08-04",
    sla_breaches_at: "2026-08-03T12:00:00Z",
    triaged_at: "2026-08-03T09:00:00Z",
    archived_at: null,
  },
  {
    id: "iss_eng_188",
    identifier: "ENG-188",
    title: "Copy run ID affordance",
    description: "Hover-only copy on trace rows.",
    priority: 3,
    estimate: 2,
    state_id: "st_eng_review",
    team_id: "team_eng",
    project_id: "proj_traces",
    milestone_id: "ms_beta",
    cycle_id: "cyc_25",
    parent_id: null,
    assignee_email: "eli@keel.dev",
    creator_email: "aria@keel.dev",
    due_date: null,
    sla_breaches_at: null,
    triaged_at: "2026-07-31T16:00:00Z",
    archived_at: null,
  },
  {
    id: "iss_eng_189",
    identifier: "ENG-189",
    title: "Highlight bookings.create chain",
    description: "Duplicate of ENG-184 — skyport leftover.",
    priority: 2,
    estimate: null,
    state_id: "st_eng_dup",
    team_id: "team_eng",
    project_id: "proj_traces",
    milestone_id: null,
    cycle_id: "cyc_25",
    parent_id: null,
    assignee_email: null,
    creator_email: "ben@keel.dev",
    due_date: null,
    sla_breaches_at: null,
    triaged_at: "2026-08-01T10:00:00Z",
    archived_at: null,
  },
  {
    id: "iss_eng_192",
    identifier: "ENG-192",
    title: "Cycle digest email",
    description: "Planned for cycle 26.",
    priority: 3,
    estimate: 5,
    state_id: "st_eng_todo",
    team_id: "team_eng",
    project_id: null,
    milestone_id: null,
    cycle_id: "cyc_26",
    parent_id: null,
    assignee_email: "aria@keel.dev",
    creator_email: "aria@keel.dev",
    due_date: null,
    sla_breaches_at: null,
    triaged_at: "2026-08-02T08:00:00Z",
    archived_at: null,
  },
] as const;

const SEED_ISSUE_LABELS = [
  { id: "il_1", issue_id: "iss_eng_184", label_id: "lab_feature" },
  { id: "il_2", issue_id: "iss_eng_184", label_id: "lab_frontend" },
  { id: "il_3", issue_id: "iss_eng_185", label_id: "lab_frontend" },
  { id: "il_4", issue_id: "iss_eng_186", label_id: "lab_feature" },
  { id: "il_5", issue_id: "iss_des_22", label_id: "lab_design" },
  { id: "il_6", issue_id: "iss_sup_12", label_id: "lab_bug" },
  { id: "il_7", issue_id: "iss_sup_12", label_id: "lab_customer" },
  { id: "il_8", issue_id: "iss_eng_188", label_id: "lab_frontend" },
] as const;

const SEED_COMMENTS = [
  {
    id: "cmt_1",
    issue_id: "iss_eng_184",
    author_email: "ben@keel.dev",
    body: "PR keel/okengine#441 — ingest now calls issues.create.",
  },
  {
    id: "cmt_2",
    issue_id: "iss_eng_184",
    author_email: "aria@keel.dev",
    body: "Keep the +3ms / 9ms read so the waterfall tip stays stable.",
  },
  {
    id: "cmt_3",
    issue_id: "iss_des_22",
    author_email: "cai@keel.dev",
    body: "ملاحظة التصميم — identifiers stay LTR inside RTL notes.",
  },
  {
    id: "cmt_4",
    issue_id: "iss_sup_12",
    author_email: "dia@keel.dev",
    body: "Snoozed until the customer replies with the claim code.",
  },
  {
    id: "cmt_5",
    issue_id: "iss_eng_186",
    author_email: "eli@keel.dev",
    body: "Range select conflicts with column reorder — need a modifier.",
  },
  {
    id: "cmt_6",
    issue_id: "iss_eng_188",
    author_email: "aria@keel.dev",
    body: "Copy is hover-only; keyboard users get the sheet action.",
  },
] as const;

const SEED_DOCUMENTS = [
  {
    id: "doc_prd_traces",
    title: "Traces pane PRD",
    body: "Select a run → pulse the github → create → notify chain on the graph.",
    parent_kind: "project",
    parent_id: "proj_traces",
  },
  {
    id: "doc_spec_184",
    title: "ENG-184 implementation spec",
    body: "WideEvent parentId links ingest → create → notify. Do not invent output on fail.",
    parent_kind: "issue",
    parent_id: "iss_eng_184",
  },
  {
    id: "doc_cycle_25",
    title: "Cycle 25 notes",
    body: "Rollover leftovers Monday 03:00 UTC. Cooldown issues stay off the next cycle.",
    parent_kind: "cycle",
    parent_id: "cyc_25",
  },
] as const;

const SEED_CUSTOMERS = [
  {
    id: "cr_1",
    issue_id: "iss_sup_12",
    customer_name: "Harbor Logistics",
    body: "Operator stuck on Sign in after rotating the claim code.",
  },
  {
    id: "cr_2",
    issue_id: "iss_sup_13",
    customer_name: "Atlas Labs",
    body: "Store browse showed yesterday's bookings after a write.",
  },
] as const;

const SEED_KV: ReadonlyArray<{ key: string; value: unknown; ttl?: string }> = [
  {
    key: "drafts:ENG-184",
    value: {
      identifier: "ENG-184",
      title: "Pulse graph on selected trace",
      expiresAt: "2026-08-14T01:00:00Z",
    },
    ttl: "2h",
  },
  {
    key: "drafts:ENG-186",
    value: {
      identifier: "ENG-186",
      title: "Store grid range select",
      expiresAt: "2026-08-14T01:10:00Z",
    },
    ttl: "45m",
  },
  {
    key: "drafts:DES-22",
    value: { identifier: "DES-22", title: "RTL cell polish", expiresAt: "2026-08-14T01:20:00Z" },
    ttl: "1d",
  },
  {
    key: "triage-snooze:SUP-12",
    value: { identifier: "SUP-12", until: "2026-08-15T12:00:00Z", reason: "waiting on customer" },
    ttl: "12h",
  },
];

const SEED_FILES: ReadonlyArray<{ key: string; data: string }> = [
  { key: "attachments/ENG-184/spec.pdf", data: "spec-bytes:ENG-184" },
  { key: "attachments/ENG-184/pr-diff.patch", data: "diff-bytes:ENG-184" },
  { key: "вложения/SUP-12/screenshot.png", data: "photo-bytes:SUP-12" },
];

const SEED_INDEX: ReadonlyArray<{
  id: string;
  vector: readonly number[];
  meta: Record<string, unknown>;
}> = [
  {
    id: "iss_eng_184",
    vector: [1, 0, 0],
    meta: { identifier: "ENG-184", title: "Pulse graph on selected trace" },
  },
  {
    id: "iss_eng_185",
    vector: [0, 1, 0],
    meta: { identifier: "ENG-185", title: "Waterfall tooltip copy" },
  },
  {
    id: "iss_des_22",
    vector: [0, 0, 1],
    meta: { identifier: "DES-22", title: "RTL cell polish" },
  },
  {
    id: "iss_sup_12",
    vector: [1, 1, 0],
    meta: { identifier: "SUP-12", title: "Customer cannot sign in" },
  },
];

type IssueRow = {
  id: string;
  identifier: string;
  title: string;
  description: string;
  priority: number;
  estimate: number | null;
  state_id: string;
  team_id: string;
  project_id: string | null;
  milestone_id: string | null;
  cycle_id: string | null;
  parent_id: string | null;
  assignee_email: string | null;
  creator_email: string;
  due_date: string | null;
  sla_breaches_at: string | null;
  triaged_at: string | null;
  archived_at: string | null;
};

/**
 * Deterministic PRNG so volume seed is stable across boots/tests.
 *
 * @param seed - 32-bit seed
 */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const ISSUE_TITLES = [
  "Fix flaky waterfall hover",
  "Cycle capacity dial",
  "Triage snooze persist",
  "PRD document template",
  "SLA banner on support issues",
  "Sub-issue auto-complete parent",
  "GitHub merge moves to Done",
  "Mention reply locale",
  "Draft TTL sweep",
  "Project health update",
  "Label group for area",
  "Replica lag chip",
  "Keyboard copy run id",
  "Index stale after rename",
  "Customer request attach",
  "Milestone progress rollup",
  "Cooldown blocks assignment",
  "Duplicate reserved status",
  "Inbox live comment",
  "Ask intake from Slack",
] as const;

const COMMENT_BODIES = [
  "Ship it — matches the spec.",
  "Need a screenshot before we accept.",
  "Rolled to the next cycle.",
  "Duplicate of the traces work.",
  "ملاحظة المراجعة — keep identifiers LTR.",
  "Assignee swapped after triage.",
] as const;

const EXTRA_PEOPLE = [
  { id: "nora", name: "Nora Singh", team_id: "team_eng" },
  { id: "omar", name: "Omar Haddad", team_id: "team_eng" },
  { id: "priya", name: "Priya Shah", team_id: "team_eng" },
  { id: "quin", name: "Quin Walsh", team_id: "team_eng" },
  { id: "rosa", name: "Rosa Alvarez", team_id: "team_eng" },
  { id: "samir", name: "Samir Cole", team_id: "team_eng" },
  { id: "tess", name: "Tess Nguyen", team_id: "team_eng" },
  { id: "uma", name: "Uma Berg", team_id: "team_eng" },
  { id: "vik", name: "Vik Noor", team_id: "team_des" },
  { id: "wen", name: "Wen Li", team_id: "team_des" },
  { id: "yael", name: "Yael Cohen", team_id: "team_sup" },
  { id: "zio", name: "Zio Hart", team_id: "team_sup" },
] as const;

const ENG_STATES = [
  "st_eng_triage",
  "st_eng_backlog",
  "st_eng_todo",
  "st_eng_progress",
  "st_eng_review",
  "st_eng_done",
  "st_eng_canceled",
] as const;

const SUP_STATES = ["st_sup_triage", "st_sup_todo", "st_sup_done"] as const;
const ESTIMATES = [1, 2, 3, 5, 8, 13, null] as const;
const LABEL_IDS = [
  "lab_bug",
  "lab_feature",
  "lab_frontend",
  "lab_regression",
  "lab_customer",
  "lab_design",
] as const;

/**
 * Build the high-volume tail so Store browse looks like a live Linear org.
 */
function generateKeelVolume(): {
  readonly members: ReadonlyArray<{
    id: string;
    team_id: string;
    name: string;
    email: string;
    role: string;
  }>;
  readonly projects: ReadonlyArray<{
    id: string;
    initiative_id: string;
    name: string;
    status: string;
    lead_email: string;
    target_date: string;
    progress: number;
  }>;
  readonly cycles: ReadonlyArray<{
    id: string;
    team_id: string;
    number: number;
    name: string;
    starts_at: string;
    ends_at: string;
    state: string;
  }>;
  readonly issues: readonly IssueRow[];
  readonly issueLabels: ReadonlyArray<{ id: string; issue_id: string; label_id: string }>;
  readonly comments: ReadonlyArray<{
    id: string;
    issue_id: string;
    author_email: string;
    body: string;
  }>;
  readonly documents: ReadonlyArray<{
    id: string;
    title: string;
    body: string;
    parent_kind: string;
    parent_id: string;
  }>;
  readonly customerRequests: ReadonlyArray<{
    id: string;
    issue_id: string;
    customer_name: string;
    body: string;
  }>;
  readonly kv: ReadonlyArray<{ key: string; value: unknown }>;
  readonly files: ReadonlyArray<{ key: string; data: string }>;
  readonly index: ReadonlyArray<{
    id: string;
    vector: readonly number[];
    meta: Record<string, unknown>;
  }>;
} {
  const rand = mulberry32(0x6ee1_5eed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

  const members = EXTRA_PEOPLE.map((p) => ({
    id: `mem_${p.id}`,
    team_id: p.team_id,
    name: p.name,
    email: `${p.id}@keel.dev`,
    role: "member",
  }));
  const emails = [
    "aria@keel.dev",
    "ben@keel.dev",
    "cai@keel.dev",
    "dia@keel.dev",
    "eli@keel.dev",
    ...members.map((m) => m.email),
  ];

  const projects = Array.from({ length: GENERATED.projects }, (_, i) => ({
    id: `proj_g_${String(i + 1).padStart(2, "0")}`,
    initiative_id: "init_console",
    name: `${pick(["Inbox", "Agents", "Replay", "Access", "Vault", "Clock"])} ${i + 1}`,
    status: pick(["backlog", "started", "completed"]),
    lead_email: pick(emails),
    target_date: `2026-0${(i % 9) + 1}-15`,
    progress: Math.floor(rand() * 100),
  }));
  const projectIds = ["proj_traces", "proj_store", ...projects.map((p) => p.id), null];

  const cycles = Array.from({ length: GENERATED.cycles }, (_, i) => {
    const number = 20 + i;
    return {
      id: `cyc_${number}`,
      team_id: "team_eng",
      number,
      name: `Cycle ${number}`,
      starts_at: `2026-0${5 + i}-16T00:00:00Z`,
      ends_at: `2026-0${5 + i}-29T23:59:59Z`,
      state: "completed" as const,
    };
  });
  const cycleIds = ["cyc_24", "cyc_25", "cyc_26", ...cycles.map((c) => c.id), null];

  const issues: IssueRow[] = [];
  for (let i = 0; i < GENERATED.issues; i += 1) {
    const roll = rand();
    const team = roll < 0.72 ? ("ENG" as const) : roll < 0.9 ? ("DES" as const) : ("SUP" as const);
    const n = 200 + i;
    const identifier = `${team}-${n}`;
    const title = `${pick(ISSUE_TITLES)} (${identifier})`;
    const rtl = rand() < 0.06;
    issues.push({
      id: `iss_${team.toLowerCase()}_${n}`,
      identifier,
      title,
      description: rtl
        ? `ملاحظة ${identifier} — ${title}`
        : `${title} filed from the lived-in keel backlog.`,
      priority: Math.floor(rand() * 5),
      estimate: pick(ESTIMATES),
      state_id: team === "SUP" ? pick(SUP_STATES) : pick(ENG_STATES),
      team_id: team === "ENG" ? "team_eng" : team === "DES" ? "team_des" : "team_sup",
      project_id: pick(projectIds),
      milestone_id: rand() < 0.25 ? pick(["ms_alpha", "ms_beta", "ms_store_ga", null]) : null,
      cycle_id: pick(cycleIds),
      parent_id:
        i > 8 && rand() < 0.08 ? (issues[i - 1 - Math.floor(rand() * 4)]?.id ?? null) : null,
      assignee_email: rand() < 0.18 ? null : pick(emails),
      creator_email: pick(emails),
      due_date:
        rand() < 0.35 ? `2026-08-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}` : null,
      sla_breaches_at: team === "SUP" && rand() < 0.25 ? "2026-08-04T12:00:00Z" : null,
      triaged_at: rand() < 0.7 ? "2026-07-20T10:00:00Z" : null,
      archived_at: rand() < 0.04 ? "2026-08-01T00:00:00Z" : null,
    });
  }

  const issueLabels: Array<{ id: string; issue_id: string; label_id: string }> = [];
  for (let i = 0; i < GENERATED.issueLabels; i += 1) {
    const issue = issues[i % issues.length]!;
    issueLabels.push({
      id: `il_g_${i}`,
      issue_id: issue.id,
      label_id: pick(LABEL_IDS),
    });
  }

  const comments: Array<{ id: string; issue_id: string; author_email: string; body: string }> = [];
  for (let i = 0; i < GENERATED.comments; i += 1) {
    const issue = issues[Math.floor(rand() * issues.length)]!;
    comments.push({
      id: `cmt_g_${i}`,
      issue_id: issue.id,
      author_email: pick(emails),
      body: pick(COMMENT_BODIES),
    });
  }

  const documents = Array.from({ length: GENERATED.documents }, (_, i) => {
    const issue = issues[i]!;
    return {
      id: `doc_g_${i}`,
      title: `Notes ${issue.identifier}`,
      body: `Working notes for ${issue.title}.`,
      parent_kind: "issue",
      parent_id: issue.id,
    };
  });

  const customers = ["Harbor Logistics", "Atlas Labs", "Nova Retail", "Delta Health"];
  const customerRequests = Array.from({ length: GENERATED.customerRequests }, (_, i) => {
    const issue = issues[issues.length - 1 - i]!;
    return {
      id: `cr_g_${i}`,
      issue_id: issue.id,
      customer_name: pick(customers),
      body: `Customer ping on ${issue.identifier}.`,
    };
  });

  const kv = Array.from({ length: GENERATED.kvKeys }, (_, i) => {
    const issue = issues[i]!;
    const ttls = ["30m", "2h", "12h", "1d"] as const;
    return {
      key: i % 7 === 0 ? `triage-snooze:${issue.identifier}` : `drafts:${issue.identifier}`,
      value: {
        identifier: issue.identifier,
        title: issue.title,
        expiresAt: "2026-08-14T02:00:00Z",
      },
      ...(i % 5 === 0 ? {} : { ttl: ttls[i % ttls.length] }),
    };
  });

  const files = Array.from({ length: GENERATED.files }, (_, i) => {
    const issue = issues[i]!;
    return {
      key: `attachments/${issue.identifier}/note-${i}.txt`,
      data: `bytes:${issue.identifier}`,
    };
  });

  const index = Array.from({ length: GENERATED.index }, (_, i) => {
    const issue = issues[i]!;
    const a = i % 3 === 0 ? 1 : 0;
    const b = i % 3 === 1 ? 1 : 0;
    const c = i % 3 === 2 ? 1 : 0;
    return {
      id: issue.id,
      vector: [a, b, c] as const,
      meta: { identifier: issue.identifier, title: issue.title },
    };
  });

  return {
    members,
    projects,
    cycles,
    issues,
    issueLabels,
    comments,
    documents,
    customerRequests,
    kv,
    files,
    index,
  };
}

const KEEL_VOLUME = generateKeelVolume();

/** Seeded facet / table counts (verifiable in tests). */
export const UI_NEXT_SEED_STORE_COUNTS = {
  sqlTeams: SEED_TEAMS.length,
  sqlMembers: SEED_MEMBERS.length + KEEL_VOLUME.members.length,
  sqlWorkflowStates: SEED_STATES.length,
  sqlLabels: SEED_LABELS.length,
  sqlInitiatives: SEED_INITIATIVES.length,
  sqlProjects: SEED_PROJECTS.length + KEEL_VOLUME.projects.length,
  sqlMilestones: SEED_MILESTONES.length,
  sqlProjectUpdates: SEED_UPDATES.length,
  sqlCycles: SEED_CYCLES.length + KEEL_VOLUME.cycles.length,
  sqlIssues: SEED_ISSUES.length + KEEL_VOLUME.issues.length,
  sqlIssueLabels: SEED_ISSUE_LABELS.length + KEEL_VOLUME.issueLabels.length,
  sqlComments: SEED_COMMENTS.length + KEEL_VOLUME.comments.length,
  sqlDocuments: SEED_DOCUMENTS.length + KEEL_VOLUME.documents.length,
  sqlCustomerRequests: SEED_CUSTOMERS.length + KEEL_VOLUME.customerRequests.length,
  kvKeys: SEED_KV.length + KEEL_VOLUME.kv.length,
  filesAttachments: SEED_FILES.length + KEEL_VOLUME.files.length,
  indexIssues: SEED_INDEX.length + KEEL_VOLUME.index.length,
  sqlIdentities: UI_NEXT_SEED_APP_SYSTEM_ROWS.oke_identities?.length ?? 0,
  sqlAppSessions: UI_NEXT_SEED_APP_SYSTEM_ROWS.oke_sessions?.length ?? 0,
  sqlCrons: UI_NEXT_SEED_APP_SYSTEM_ROWS.oke_crons?.length ?? 0,
} as const;

/**
 * Seed real Store rows/keys/objects/vectors into the Console Manifest memory
 * runtime so every facet browse is non-empty (SQL/KV/Files/Index).
 *
 * @param runtime - Booted Console Store runtime
 */
export async function seedUiNextStoreData(runtime: StoreRuntime): Promise<void> {
  const sql = (await runtime.openRef("sql:db", {
    effects: { writes: ["sql:db"] },
    revealPii: true,
  })) as SqlStoreHandle;

  const teams = defineTable("teams", {
    id: true,
    key: true,
    name: true,
    parent_id: true,
  });
  const members = defineTable("members", {
    id: true,
    team_id: true,
    name: true,
    email: classify({ pii: true }),
    role: true,
  });
  const workflowStates = defineTable("workflow_states", {
    id: true,
    team_id: true,
    name: true,
    type: true,
    position: true,
  });
  const labels = defineTable("labels", {
    id: true,
    team_id: true,
    name: true,
    group_name: true,
  });
  const initiatives = defineTable("initiatives", {
    id: true,
    name: true,
    status: true,
    owner_email: classify({ pii: true }),
    target_date: true,
  });
  const projects = defineTable("projects", {
    id: true,
    initiative_id: true,
    name: true,
    status: true,
    lead_email: classify({ pii: true }),
    target_date: true,
    progress: true,
  });
  const milestones = defineTable("project_milestones", {
    id: true,
    project_id: true,
    name: true,
    target_date: true,
    sort_order: true,
  });
  const updates = defineTable("project_updates", {
    id: true,
    project_id: true,
    health: true,
    body: true,
    author_email: classify({ pii: true }),
  });
  const cycles = defineTable("cycles", {
    id: true,
    team_id: true,
    number: true,
    name: true,
    starts_at: true,
    ends_at: true,
    state: true,
  });
  const issues = defineTable("issues", {
    id: true,
    identifier: true,
    title: true,
    description: true,
    priority: true,
    estimate: true,
    state_id: true,
    team_id: true,
    project_id: true,
    milestone_id: true,
    cycle_id: true,
    parent_id: true,
    assignee_email: classify({ pii: true }),
    creator_email: classify({ pii: true }),
    due_date: true,
    sla_breaches_at: true,
    triaged_at: true,
    archived_at: true,
  });
  const issueLabels = defineTable("issue_labels", {
    id: true,
    issue_id: true,
    label_id: true,
  });
  const comments = defineTable("comments", {
    id: true,
    issue_id: true,
    author_email: classify({ pii: true }),
    body: true,
  });
  const documents = defineTable("documents", {
    id: true,
    title: true,
    body: true,
    parent_kind: true,
    parent_id: true,
  });
  const customerRequests = defineTable("customer_requests", {
    id: true,
    issue_id: true,
    customer_name: true,
    body: true,
  });

  const tables: ReadonlyArray<readonly [ReturnType<typeof defineTable>, readonly object[]]> = [
    [teams, SEED_TEAMS],
    [members, [...SEED_MEMBERS, ...KEEL_VOLUME.members]],
    [workflowStates, SEED_STATES],
    [labels, SEED_LABELS],
    [initiatives, SEED_INITIATIVES],
    [projects, [...SEED_PROJECTS, ...KEEL_VOLUME.projects]],
    [milestones, SEED_MILESTONES],
    [updates, SEED_UPDATES],
    [cycles, [...SEED_CYCLES, ...KEEL_VOLUME.cycles]],
    [issues, [...SEED_ISSUES, ...KEEL_VOLUME.issues]],
    [issueLabels, [...SEED_ISSUE_LABELS, ...KEEL_VOLUME.issueLabels]],
    [comments, [...SEED_COMMENTS, ...KEEL_VOLUME.comments]],
    [documents, [...SEED_DOCUMENTS, ...KEEL_VOLUME.documents]],
    [customerRequests, [...SEED_CUSTOMERS, ...KEEL_VOLUME.customerRequests]],
  ];

  for (const [table, rows] of tables) {
    await sql.ensureTable(table);
    for (const row of rows) {
      await sql.insert(table).values(row);
    }
  }

  for (const [name, rows] of Object.entries(UI_NEXT_SEED_APP_SYSTEM_ROWS)) {
    const declared = UI_NEXT_SEED_APP_SYSTEM_TABLES[name]?.columns ?? {};
    const columns = Object.fromEntries(
      Object.entries(declared).map(([key, spec]) => {
        const pii = spec.pii === true;
        const sensitive = spec.sensitive === true;
        return [
          key,
          pii || sensitive
            ? classify({ ...(pii ? { pii } : {}), ...(sensitive ? { sensitive } : {}) })
            : true,
        ];
      }),
    );
    const table = defineTable(name, columns);
    await sql.ensureTable(table);
    for (const row of rows) {
      await sql.insert(table).values(row);
    }
  }

  const kv = (await runtime.openRef("kv:cache", {
    effects: { writes: ["kv:cache"] },
  })) as KvStoreFxHandle;
  for (const entry of [...SEED_KV, ...KEEL_VOLUME.kv]) {
    await kv.set(entry.key, entry.value, "ttl" in entry ? entry.ttl : undefined);
  }

  const files = (await runtime.openRef("files:attachments", {
    effects: { writes: ["files:attachments"] },
  })) as FilesStoreFxHandle;
  for (const entry of [...SEED_FILES, ...KEEL_VOLUME.files]) {
    await files.put(entry.key, entry.data);
  }

  const index = (await runtime.openRef("index:search", {
    effects: { writes: ["index:search"] },
  })) as VectorIndexStoreFxHandle;
  for (const entry of [...SEED_INDEX, ...KEEL_VOLUME.index]) {
    await index.upsert(entry.id, entry.vector, entry.meta);
  }
}
