/**
 * Lived-in keel Store rows for Console ui-next seed.
 *
 * Workspace ENG / DES / GTM — spaces, goals, projects, sections, tasks,
 * comments, plus KV drafts/reminders, file attachments, and semantic task index.
 */

import { defineTable } from "../../elements/store.ts";
import { classify } from "../../elements/store/classify.ts";
import {
  UI_NEXT_SEED_APP_SYSTEM_ROWS,
  UI_NEXT_SEED_APP_SYSTEM_TABLES,
} from "./ui-next-seed-app-schema.ts";
import type { SqlRow } from "../../drivers/types.ts";
import type { SqlStoreHandle } from "../../elements/store/sql-session.ts";
import type {
  FilesStoreFxHandle,
  KvStoreFxHandle,
  StoreRuntime,
  VectorIndexStoreFxHandle,
} from "../../elements/store/runtime.ts";

/** Extra generated volume on top of the featured Harbor story rows. */
const GENERATED = {
  members: 12,
  projects: 6,
  tasks: 500,
  comments: 220,
  documents: 20,
  kvKeys: 40,
  files: 24,
  index: 44,
} as const;

const SEED_SPACES = [
  { id: "space_eng", key: "ENG", name: "Engineering", color: "#2563eb" },
  { id: "space_des", key: "DES", name: "Design", color: "#db2777" },
  { id: "space_gtm", key: "GTM", name: "Go-to-market", color: "#059669" },
] as const;

const SEED_MEMBERS = [
  {
    id: "mem_aria",
    space_id: "space_eng",
    name: "Aria Chen",
    email: "aria@keel.dev",
    role: "project_manager",
  },
  {
    id: "mem_ben",
    space_id: "space_eng",
    name: "Ben Okonkwo",
    email: "ben@keel.dev",
    role: "developer",
  },
  {
    id: "mem_cai",
    space_id: "space_des",
    name: "Cai Moreno",
    email: "cai@keel.dev",
    role: "member",
  },
  {
    id: "mem_dia",
    space_id: "space_gtm",
    name: "Dia Farouk",
    email: "dia@keel.dev",
    role: "guest",
  },
  {
    id: "mem_eli",
    space_id: "space_eng",
    name: "Eli Park",
    email: "eli@keel.dev",
    role: "developer",
  },
] as const;

const SEED_GOALS = [
  {
    id: "goal_harbor",
    name: "Harbor GA",
    status: "at_risk",
    owner_email: "aria@keel.dev",
    target_date: "2026-09-30",
  },
] as const;

const SEED_PROJECTS = [
  {
    id: "proj_api",
    space_id: "space_eng",
    goal_id: "goal_harbor",
    name: "Harbor API",
    status: "started",
    lead_email: "ben@keel.dev",
    start_date: "2026-07-01",
    target_date: "2026-08-29",
    color: "#2563eb",
  },
  {
    id: "proj_web",
    space_id: "space_eng",
    goal_id: "goal_harbor",
    name: "Harbor Web",
    status: "started",
    lead_email: "eli@keel.dev",
    start_date: "2026-07-08",
    target_date: "2026-09-12",
    color: "#7c3aed",
  },
  {
    id: "proj_launch",
    space_id: "space_gtm",
    goal_id: "goal_harbor",
    name: "Launch checklist",
    status: "planned",
    lead_email: "aria@keel.dev",
    start_date: "2026-08-01",
    target_date: "2026-09-30",
    color: "#059669",
  },
] as const;

const SECTIONS = ["Backlog", "Ready", "Doing", "Review", "Done"] as const;

const SEED_SECTIONS = [
  ...SECTIONS.map((name, i) => ({
    id: `sec_api_${i}`,
    project_id: "proj_api",
    name,
    sort_order: i,
  })),
  ...SECTIONS.map((name, i) => ({
    id: `sec_web_${i}`,
    project_id: "proj_web",
    name,
    sort_order: i,
  })),
  ...SECTIONS.map((name, i) => ({
    id: `sec_launch_${i}`,
    project_id: "proj_launch",
    name,
    sort_order: i,
  })),
] as const;

const SEED_TAGS = [
  { id: "tag_bug", name: "bug", group_name: "type" },
  { id: "tag_feature", name: "feature", group_name: "type" },
  { id: "tag_customer", name: "customer", group_name: "source" },
  { id: "tag_design", name: "design", group_name: "area" },
] as const;

type TaskRow = {
  id: string;
  identifier: string;
  title: string;
  description: string;
  kind: string;
  priority: number;
  estimate: number | null;
  status: string;
  space_id: string;
  project_id: string | null;
  section_id: string | null;
  parent_id: string | null;
  due_date: string | null;
  completed_at: string | null;
  archived_at: string | null;
  creator_email: string;
  role_needed: string | null;
};

function task(row: Omit<TaskRow, "kind" | "estimate" | "parent_id" | "due_date" | "completed_at" | "archived_at" | "role_needed"> & Partial<TaskRow>): TaskRow {
  return {
    kind: "task",
    estimate: null,
    parent_id: null,
    due_date: null,
    completed_at: null,
    archived_at: null,
    role_needed: null,
    ...row,
  };
}

const SEED_TASKS: readonly TaskRow[] = [
  task({
    id: "tsk_eng_12",
    identifier: "ENG-12",
    title: "SSO login fails",
    description: "Customer cannot sign in after rotating the claim code.",
    priority: 1,
    estimate: 5,
    status: "doing",
    space_id: "space_eng",
    project_id: "proj_api",
    section_id: "sec_api_2",
    due_date: "2026-08-08",
    creator_email: "aria@keel.dev",
    role_needed: "developer",
  }),
  task({
    id: "tsk_eng_13",
    identifier: "ENG-13",
    title: "Billing webhook",
    description: "Stripe → Harbor invoice settled.",
    priority: 2,
    estimate: 8,
    status: "doing",
    space_id: "space_eng",
    project_id: "proj_api",
    section_id: "sec_api_2",
    creator_email: "ben@keel.dev",
    role_needed: "developer",
  }),
  task({
    id: "tsk_eng_14",
    identifier: "ENG-14",
    title: "Checkout polish",
    description: "Blocked on billing webhook.",
    priority: 2,
    estimate: 5,
    status: "ready",
    space_id: "space_eng",
    project_id: "proj_web",
    section_id: "sec_web_1",
    creator_email: "eli@keel.dev",
    role_needed: "developer",
  }),
  task({
    id: "tsk_eng_10",
    identifier: "ENG-10",
    title: "API freeze",
    description: "No breaking changes after this date.",
    kind: "milestone",
    priority: 2,
    status: "ready",
    space_id: "space_eng",
    project_id: "proj_api",
    section_id: "sec_api_1",
    due_date: "2026-08-20",
    creator_email: "aria@keel.dev",
    role_needed: "project_manager",
  }),
  task({
    id: "tsk_eng_9",
    identifier: "ENG-9",
    title: "Weekly launch review",
    description: "Recurring PM + eng sync.",
    priority: 3,
    status: "todo",
    space_id: "space_gtm",
    project_id: "proj_launch",
    section_id: "sec_launch_1",
    creator_email: "aria@keel.dev",
    role_needed: "project_manager",
  }),
  task({
    id: "tsk_des_4",
    identifier: "DES-4",
    title: "RTL checkout labels",
    description: "ملاحظة التصميم — identifiers stay LTR.",
    priority: 3,
    estimate: 3,
    status: "todo",
    space_id: "space_des",
    project_id: "proj_web",
    section_id: "sec_web_1",
    due_date: "2026-08-10",
    creator_email: "cai@keel.dev",
  }),
  task({
    id: "tsk_eng_8",
    identifier: "ENG-8",
    title: "Replica lag banner",
    description: "Overdue — store browse showed stale rows.",
    priority: 1,
    estimate: 3,
    status: "todo",
    space_id: "space_eng",
    project_id: "proj_web",
    section_id: "sec_web_0",
    due_date: "2026-08-01",
    creator_email: "eli@keel.dev",
    role_needed: "developer",
  }),
];

const SEED_ASSIGNEES = [
  { id: "asg_1", task_id: "tsk_eng_12", assignee_email: "ben@keel.dev" },
  { id: "asg_2", task_id: "tsk_eng_13", assignee_email: "ben@keel.dev" },
  { id: "asg_3", task_id: "tsk_eng_14", assignee_email: "eli@keel.dev" },
  { id: "asg_4", task_id: "tsk_eng_8", assignee_email: "eli@keel.dev" },
  { id: "asg_5", task_id: "tsk_eng_9", assignee_email: "aria@keel.dev" },
] as const;

const SEED_UPDATES = [
  {
    id: "upd_web_1",
    project_id: "proj_web",
    health: "at_risk",
    body: "Checkout polish blocked on billing webhook.",
    author_email: "eli@keel.dev",
  },
] as const;

const SEED_COMMENTS = [
  {
    id: "cmt_1",
    task_id: "tsk_eng_12",
    author_email: "aria@keel.dev",
    body: "Form intake — assign to a developer. @ben@keel.dev can you take this?",
  },
  {
    id: "cmt_2",
    task_id: "tsk_eng_12",
    author_email: "ben@keel.dev",
    body: "Repro'd — session cleared after claim rotate.",
  },
  {
    id: "cmt_3",
    task_id: "tsk_des_4",
    author_email: "cai@keel.dev",
    body: "ملاحظة التصميم — identifiers stay LTR inside RTL notes.",
  },
] as const;

const SEED_DOCUMENTS = [
  {
    id: "doc_prd_api",
    title: "Harbor API PRD",
    body: "SSO + billing webhook before freeze.",
    parent_kind: "project",
    parent_id: "proj_api",
  },
  {
    id: "doc_spec_12",
    title: "ENG-12 implementation spec",
    body: "Claim rotate must keep the session cookie.",
    parent_kind: "task",
    parent_id: "tsk_eng_12",
  },
] as const;

const SEED_VIEWS = [
  {
    id: "view_web_board",
    project_id: "proj_web",
    name: "Web board",
    kind: "board",
    filters_json: "{}",
    owner_email: "aria@keel.dev",
  },
  {
    id: "view_api_list",
    project_id: "proj_api",
    name: "API list",
    kind: "list",
    filters_json: "{}",
    owner_email: "ben@keel.dev",
  },
  {
    id: "view_launch_tl",
    project_id: "proj_launch",
    name: "Launch timeline",
    kind: "timeline",
    filters_json: "{}",
    owner_email: "aria@keel.dev",
  },
] as const;

const SEED_FORMS = [
  {
    id: "form_customer",
    project_id: "proj_api",
    name: "Customer request",
    schema_json: '{"title":"string","body":"string"}',
  },
] as const;

const SEED_SUBMISSIONS = [
  {
    id: "sub_1",
    form_id: "form_customer",
    task_id: "tsk_eng_12",
    payload_json: '{"title":"SSO login fails"}',
    customer_name: "Harbor Logistics",
  },
] as const;

const SEED_INBOX = [
  {
    id: "inb_1",
    member_email: "aria@keel.dev",
    kind: "form-submitted",
    title: "Harbor Logistics",
    ref_id: "tsk_eng_12",
    read_at: null as string | null,
  },
  {
    id: "inb_2",
    member_email: "ben@keel.dev",
    kind: "task-assigned",
    title: "SSO login fails",
    ref_id: "tsk_eng_12",
    read_at: null,
  },
] as const;

const SEED_KV: ReadonlyArray<{ key: string; value: unknown; ttl?: string }> = [
  {
    key: "drafts:ENG-12",
    value: {
      identifier: "ENG-12",
      title: "SSO login fails",
      expiresAt: "2026-08-14T01:00:00Z",
    },
    ttl: "2h",
  },
  {
    key: "drafts:ENG-14",
    value: {
      identifier: "ENG-14",
      title: "Checkout polish",
      expiresAt: "2026-08-14T01:10:00Z",
    },
    ttl: "45m",
  },
  {
    key: "reminders:ENG-8",
    value: { identifier: "ENG-8", until: "2026-08-15T12:00:00Z", reason: "overdue banner" },
    ttl: "12h",
  },
];

/** 1×1 PNG so the Files inspector can preview a real image. */
const SEED_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (ch) => ch.charCodeAt(0),
);

const SEED_FILES: ReadonlyArray<{
  key: string;
  originalName: string;
  data: string | Uint8Array;
}> = [
  { key: "attachments/tsk_eng_12/spec.pdf", originalName: "spec.pdf", data: "spec-bytes:ENG-12" },
  {
    key: "attachments/tsk_eng_12/screenshot.png",
    originalName: "screenshot.png",
    data: SEED_PNG,
  },
];

const SEED_INDEX: ReadonlyArray<{
  id: string;
  vector: readonly number[];
  meta: Record<string, unknown>;
}> = [
  {
    id: "tsk_eng_12",
    vector: [1, 0, 0],
    meta: { identifier: "ENG-12", title: "SSO login fails" },
  },
  {
    id: "tsk_eng_13",
    vector: [0, 1, 0],
    meta: { identifier: "ENG-13", title: "Billing webhook" },
  },
  {
    id: "tsk_des_4",
    vector: [0, 0, 1],
    meta: { identifier: "DES-4", title: "RTL checkout labels" },
  },
  {
    id: "tsk_eng_8",
    vector: [1, 1, 0],
    meta: { identifier: "ENG-8", title: "Replica lag banner" },
  },
];

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

const TASK_TITLES = [
  "Fix flaky checkout hover",
  "Goal capacity dial",
  "Reminder persist",
  "PRD document template",
  "Overdue banner on tasks",
  "Subtask auto-complete parent",
  "GitHub PR moves to Done",
  "Mention reply locale",
  "Draft TTL sweep",
  "Project health update",
  "Tag group for area",
  "Replica lag chip",
  "Keyboard copy run id",
  "Index stale after rename",
  "Form attach",
  "Section progress rollup",
  "Role needed blocks assignment",
  "Duplicate reserved status",
  "Inbox live comment",
  "Ask intake from Slack",
] as const;

const COMMENT_BODIES = [
  "Ship it — matches the spec.",
  "Need a screenshot before we accept.",
  "Moved to the next section.",
  "Duplicate of the SSO work.",
  "ملاحظة المراجعة — keep identifiers LTR.",
  "Assignee swapped after form intake.",
] as const;

const EXTRA_PEOPLE = [
  { id: "nora", name: "Nora Singh", space_id: "space_eng" },
  { id: "omar", name: "Omar Haddad", space_id: "space_eng" },
  { id: "priya", name: "Priya Shah", space_id: "space_eng" },
  { id: "quin", name: "Quin Walsh", space_id: "space_eng" },
  { id: "rosa", name: "Rosa Alvarez", space_id: "space_eng" },
  { id: "samir", name: "Samir Cole", space_id: "space_eng" },
  { id: "tess", name: "Tess Nguyen", space_id: "space_eng" },
  { id: "uma", name: "Uma Berg", space_id: "space_eng" },
  { id: "vik", name: "Vik Noor", space_id: "space_des" },
  { id: "wen", name: "Wen Li", space_id: "space_des" },
  { id: "yael", name: "Yael Cohen", space_id: "space_gtm" },
  { id: "zio", name: "Zio Hart", space_id: "space_gtm" },
] as const;

const STATUSES = ["backlog", "todo", "ready", "doing", "review", "done"] as const;
const ESTIMATES = [1, 2, 3, 5, 8, 13, null] as const;
const KINDS = ["task", "task", "task", "subtask", "milestone"] as const;
const ROLES = ["developer", "project_manager", "member", null] as const;

/**
 * Build the high-volume tail so Store browse looks like a live work-management org.
 */
function generateKeelVolume(): {
  readonly members: ReadonlyArray<{
    id: string;
    space_id: string;
    name: string;
    email: string;
    role: string;
  }>;
  readonly projects: ReadonlyArray<{
    id: string;
    space_id: string;
    goal_id: string;
    name: string;
    status: string;
    lead_email: string;
    start_date: string;
    target_date: string;
    color: string;
  }>;
  readonly tasks: readonly TaskRow[];
  readonly comments: ReadonlyArray<{
    id: string;
    task_id: string;
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
  readonly kv: ReadonlyArray<{ key: string; value: unknown; ttl?: string }>;
  readonly files: ReadonlyArray<{ key: string; originalName: string; data: string }>;
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
    space_id: p.space_id,
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
    space_id: pick(["space_eng", "space_des", "space_gtm"] as const),
    goal_id: "goal_harbor",
    name: `${pick(["Inbox", "Agents", "Replay", "Access", "Vault", "Clock"])} ${i + 1}`,
    status: pick(["backlog", "started", "completed"]),
    lead_email: pick(emails),
    start_date: `2026-0${(i % 9) + 1}-01`,
    target_date: `2026-0${(i % 9) + 1}-15`,
    color: "#64748b",
  }));
  const projectIds = ["proj_api", "proj_web", "proj_launch", ...projects.map((p) => p.id), null];

  const tasks: TaskRow[] = [];
  for (let i = 0; i < GENERATED.tasks; i += 1) {
    const roll = rand();
    const space = roll < 0.72 ? ("ENG" as const) : roll < 0.9 ? ("DES" as const) : ("GTM" as const);
    const n = 200 + i;
    const identifier = `${space}-${n}`;
    const title = `${pick(TASK_TITLES)} (${identifier})`;
    const rtl = rand() < 0.06;
    tasks.push({
      id: `tsk_${space.toLowerCase()}_${n}`,
      identifier,
      title,
      description: rtl
        ? `ملاحظة ${identifier} — ${title}`
        : `${title} filed from the lived-in keel backlog.`,
      kind: pick(KINDS),
      priority: Math.floor(rand() * 5),
      estimate: pick(ESTIMATES),
      status: pick(STATUSES),
      space_id: space === "ENG" ? "space_eng" : space === "DES" ? "space_des" : "space_gtm",
      project_id: pick(projectIds),
      section_id: rand() < 0.4 ? pick(["sec_api_0", "sec_api_2", "sec_web_1", null]) : null,
      parent_id:
        i > 8 && rand() < 0.08 ? (tasks[i - 1 - Math.floor(rand() * 4)]?.id ?? null) : null,
      creator_email: pick(emails),
      role_needed: pick(ROLES),
      due_date:
        rand() < 0.35 ? `2026-08-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}` : null,
      completed_at: rand() < 0.12 ? "2026-08-01T00:00:00Z" : null,
      archived_at: rand() < 0.04 ? "2026-08-01T00:00:00Z" : null,
    });
  }

  const comments: Array<{ id: string; task_id: string; author_email: string; body: string }> = [];
  for (let i = 0; i < GENERATED.comments; i += 1) {
    const row = tasks[Math.floor(rand() * tasks.length)]!;
    comments.push({
      id: `cmt_g_${i}`,
      task_id: row.id,
      author_email: pick(emails),
      body: pick(COMMENT_BODIES),
    });
  }

  const documents = Array.from({ length: GENERATED.documents }, (_, i) => {
    const row = tasks[i]!;
    return {
      id: `doc_g_${i}`,
      title: `Notes ${row.identifier}`,
      body: `Working notes for ${row.title}.`,
      parent_kind: "task",
      parent_id: row.id,
    };
  });

  const kv = Array.from({ length: GENERATED.kvKeys }, (_, i) => {
    const row = tasks[i]!;
    const ttls = ["30m", "2h", "12h", "1d"] as const;
    return {
      key: i % 7 === 0 ? `reminders:${row.identifier}` : `drafts:${row.identifier}`,
      value: {
        identifier: row.identifier,
        title: row.title,
        expiresAt: "2026-08-14T02:00:00Z",
      },
      ...(i % 5 === 0 ? {} : { ttl: ttls[i % ttls.length] }),
    };
  });

  const files = Array.from({ length: GENERATED.files }, (_, i) => {
    const row = tasks[i]!;
    return {
      key: `attachments/${row.identifier}/note-${i}.txt`,
      originalName: `note-${i}.txt`,
      data: `bytes:${row.identifier}`,
    };
  });

  const index = Array.from({ length: GENERATED.index }, (_, i) => {
    const row = tasks[i]!;
    const a = i % 3 === 0 ? 1 : 0;
    const b = i % 3 === 1 ? 1 : 0;
    const c = i % 3 === 2 ? 1 : 0;
    return {
      id: row.id,
      vector: [a, b, c] as const,
      meta: { identifier: row.identifier, title: row.title },
    };
  });

  return {
    members,
    projects,
    tasks,
    comments,
    documents,
    kv,
    files,
    index,
  };
}

const KEEL_VOLUME = generateKeelVolume();

/** Seeded facet / table counts (verifiable in tests). */
export const UI_NEXT_SEED_STORE_COUNTS = {
  sqlSpaces: SEED_SPACES.length,
  sqlMembers: SEED_MEMBERS.length + KEEL_VOLUME.members.length,
  sqlGoals: SEED_GOALS.length,
  sqlProjects: SEED_PROJECTS.length + KEEL_VOLUME.projects.length,
  sqlSections: SEED_SECTIONS.length,
  sqlTasks: SEED_TASKS.length + KEEL_VOLUME.tasks.length,
  sqlComments: SEED_COMMENTS.length + KEEL_VOLUME.comments.length,
  sqlDocuments: SEED_DOCUMENTS.length + KEEL_VOLUME.documents.length,
  kvKeys: SEED_KV.length + KEEL_VOLUME.kv.length,
  filesAttachments: SEED_FILES.length + KEEL_VOLUME.files.length,
  indexTasks: SEED_INDEX.length + KEEL_VOLUME.index.length,
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

  const spaces = defineTable("spaces", {
    id: true,
    key: true,
    name: true,
    color: true,
  });
  const members = defineTable("members", {
    id: true,
    space_id: true,
    name: true,
    email: classify({ pii: true }),
    role: true,
  });
  const goals = defineTable("goals", {
    id: true,
    name: true,
    status: true,
    owner_email: classify({ pii: true }),
    target_date: true,
  });
  const projects = defineTable("projects", {
    id: true,
    space_id: true,
    goal_id: true,
    name: true,
    status: true,
    lead_email: classify({ pii: true }),
    start_date: true,
    target_date: true,
    color: true,
  });
  const sections = defineTable("sections", {
    id: true,
    project_id: true,
    name: true,
    sort_order: true,
  });
  const tasks = defineTable("tasks", {
    id: true,
    identifier: true,
    title: true,
    description: true,
    kind: true,
    priority: true,
    estimate: true,
    status: true,
    space_id: true,
    project_id: true,
    section_id: true,
    parent_id: true,
    due_date: true,
    completed_at: true,
    archived_at: true,
    creator_email: classify({ pii: true }),
    role_needed: true,
  });
  const assignees = defineTable("task_assignees", {
    id: true,
    task_id: true,
    assignee_email: classify({ pii: true }),
  });
  const comments = defineTable("comments", {
    id: true,
    task_id: true,
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
  const fileObjects = defineTable("file_objects", {
    id: true,
    object_key: true,
    original_name: true,
    content_type: true,
    size_bytes: true,
    store_ref: true,
  });
  const updates = defineTable("project_updates", {
    id: true,
    project_id: true,
    health: true,
    body: true,
    author_email: classify({ pii: true }),
  });
  const views = defineTable("views", {
    id: true,
    project_id: true,
    name: true,
    kind: true,
    filters_json: true,
    owner_email: classify({ pii: true }),
  });
  const forms = defineTable("forms", {
    id: true,
    project_id: true,
    name: true,
    schema_json: true,
  });
  const submissions = defineTable("form_submissions", {
    id: true,
    form_id: true,
    task_id: true,
    payload_json: true,
    customer_name: true,
  });
  const inbox = defineTable("inbox", {
    id: true,
    member_email: classify({ pii: true }),
    kind: true,
    title: true,
    ref_id: true,
    read_at: true,
  });
  const tags = defineTable("tags", {
    id: true,
    name: true,
    group_name: true,
  });

  const tables: ReadonlyArray<readonly [ReturnType<typeof defineTable>, readonly SqlRow[]]> = [
    [spaces, SEED_SPACES],
    [members, [...SEED_MEMBERS, ...KEEL_VOLUME.members]],
    [goals, SEED_GOALS],
    [projects, [...SEED_PROJECTS, ...KEEL_VOLUME.projects]],
    [sections, SEED_SECTIONS],
    [tags, SEED_TAGS],
    [tasks, [...SEED_TASKS, ...KEEL_VOLUME.tasks]],
    [assignees, SEED_ASSIGNEES],
    [comments, [...SEED_COMMENTS, ...KEEL_VOLUME.comments]],
    [documents, [...SEED_DOCUMENTS, ...KEEL_VOLUME.documents]],
    [updates, SEED_UPDATES],
    [views, SEED_VIEWS],
    [forms, SEED_FORMS],
    [submissions, SEED_SUBMISSIONS],
    [inbox, SEED_INBOX],
    [
      fileObjects,
      [...SEED_FILES, ...KEEL_VOLUME.files].map((entry) => ({
        id: entry.key,
        object_key: entry.key,
        original_name: entry.originalName,
        content_type: entry.originalName.endsWith(".png")
          ? "image/png"
          : entry.originalName.endsWith(".pdf")
            ? "application/pdf"
            : entry.originalName.endsWith(".patch")
              ? "text/x-patch"
              : "text/plain",
        size_bytes: typeof entry.data === "string" ? entry.data.length : entry.data.byteLength,
        store_ref: "files:attachments",
      })),
    ],
  ];

  for (const [table, rows] of tables) {
    await sql.ensureTable(table);
    for (const row of rows) {
      await sql.insert(table).values(row);
    }
  }

  for (const [name, rows] of Object.entries(UI_NEXT_SEED_APP_SYSTEM_ROWS)) {
    const declared = UI_NEXT_SEED_APP_SYSTEM_TABLES[name]?.columns ?? {};
    const columns: Record<string, true | ReturnType<typeof classify>> = {};
    for (const [key, spec] of Object.entries(declared)) {
      const pii = spec.pii === true;
      const sensitive = spec.sensitive === true;
      columns[key] =
        pii || sensitive
          ? classify({ ...(pii ? { pii } : {}), ...(sensitive ? { sensitive } : {}) })
          : true;
    }
    const table = defineTable(name, columns);
    await sql.ensureTable(table);
    for (const row of rows) {
      await sql.insert(table).values(row as SqlRow);
    }
  }

  const kv = (await runtime.openRef("kv:cache", {
    effects: { writes: ["kv:cache"] },
  })) as KvStoreFxHandle;
  for (const entry of [...SEED_KV, ...KEEL_VOLUME.kv]) {
    await kv.set(
      entry.key,
      entry.value,
      "ttl" in entry && typeof entry.ttl === "string" ? entry.ttl : undefined,
    );
  }

  const files = (await runtime.openRef("files:attachments", {
    effects: { writes: ["files:attachments"] },
  })) as FilesStoreFxHandle;
  const allFiles = [...SEED_FILES, ...KEEL_VOLUME.files];
  for (const entry of allFiles) {
    await files.put(entry.key, entry.data);
  }
  const catalog = {
    version: 1 as const,
    objects: Object.fromEntries(
      allFiles.map((entry) => [
        entry.key,
        {
          originalName: entry.originalName,
          contentType: entry.originalName.endsWith(".png")
            ? "image/png"
            : entry.originalName.endsWith(".pdf")
              ? "application/pdf"
              : entry.originalName.endsWith(".patch")
                ? "text/x-patch"
                : "text/plain",
          sizeBytes: typeof entry.data === "string" ? entry.data.length : entry.data.byteLength,
          updatedAt: "2026-08-14T00:00:00.000Z",
        },
      ]),
    ),
  };
  await files.put(".oke/catalog.json", JSON.stringify(catalog));

  const index = (await runtime.openRef("index:search", {
    effects: { writes: ["index:search"] },
  })) as VectorIndexStoreFxHandle;
  for (const entry of [...SEED_INDEX, ...KEEL_VOLUME.index]) {
    await index.upsert(entry.id, entry.vector, entry.meta);
  }
}
