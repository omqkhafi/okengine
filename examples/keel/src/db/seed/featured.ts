/**
 * Featured Harbor GA story — ENG / DES / GTM, Aria–Eli, ENG-12 intake chain.
 * Column names match `schema.decl` (camelCase).
 */

const T0 = 1_753_920_000_000;

/** Workspace spaces. */
export const FEATURED_SPACES = [
  { id: "space_eng", key: "ENG", name: "Engineering", color: "#2563eb", createdAt: T0 },
  { id: "space_des", key: "DES", name: "Design", color: "#db2777", createdAt: T0 },
  { id: "space_gtm", key: "GTM", name: "Go-to-market", color: "#059669", createdAt: T0 },
] as const;

/**
 * Featured workspace members — ten rungs, owner → guest.
 * Demo User and Member keep the Console invoke-as emails.
 */
export const FEATURED_MEMBERS = [
  {
    id: "mem_demo",
    spaceId: "space_eng",
    name: "Demo User",
    email: "demo@example.com",
    role: "owner",
    createdAt: T0,
  },
  {
    id: "mem_admin",
    spaceId: "space_eng",
    name: "Avery Cole",
    email: "admin@keel.dev",
    role: "admin",
    createdAt: T0,
  },
  {
    id: "mem_aria",
    spaceId: "space_eng",
    name: "Aria Chen",
    email: "aria@keel.dev",
    role: "project_manager",
    createdAt: T0,
  },
  {
    id: "mem_lead",
    spaceId: "space_eng",
    name: "Jules Hart",
    email: "jules@keel.dev",
    role: "lead",
    createdAt: T0,
  },
  {
    id: "mem_ben",
    spaceId: "space_eng",
    name: "Ben Okonkwo",
    email: "ben@keel.dev",
    role: "developer",
    createdAt: T0,
  },
  {
    id: "mem_eli",
    spaceId: "space_eng",
    name: "Eli Park",
    email: "eli@keel.dev",
    role: "contributor",
    createdAt: T0,
  },
  {
    id: "mem_cai",
    spaceId: "space_des",
    name: "Cai Moreno",
    email: "cai@keel.dev",
    role: "member",
    createdAt: T0,
  },
  {
    id: "mem_member",
    spaceId: "space_des",
    name: "Member",
    email: "member@example.com",
    role: "member",
    createdAt: T0,
  },
  {
    id: "mem_commenter",
    spaceId: "space_gtm",
    name: "Kit Rowe",
    email: "kit@keel.dev",
    role: "commenter",
    createdAt: T0,
  },
  {
    id: "mem_dia",
    spaceId: "space_gtm",
    name: "Dia Farouk",
    email: "dia@keel.dev",
    role: "guest",
    createdAt: T0,
  },
] as const;

/** Featured goal. */
export const FEATURED_GOALS = [
  {
    id: "goal_harbor",
    name: "Harbor GA",
    status: "at_risk",
    ownerEmail: "aria@keel.dev",
    targetDate: "2026-09-30",
    createdAt: T0,
    updatedAt: T0,
  },
] as const;

/** Featured projects. */
export const FEATURED_PROJECTS = [
  {
    id: "proj_api",
    spaceId: "space_eng",
    goalId: "goal_harbor",
    name: "Harbor API",
    status: "started",
    leadEmail: "ben@keel.dev",
    startDate: "2026-07-01",
    targetDate: "2026-08-29",
    color: "#2563eb",
    createdAt: T0,
    updatedAt: T0,
  },
  {
    id: "proj_web",
    spaceId: "space_eng",
    goalId: "goal_harbor",
    name: "Harbor Web",
    status: "started",
    leadEmail: "eli@keel.dev",
    startDate: "2026-07-08",
    targetDate: "2026-09-12",
    color: "#7c3aed",
    createdAt: T0,
    updatedAt: T0,
  },
  {
    id: "proj_launch",
    spaceId: "space_gtm",
    goalId: "goal_harbor",
    name: "Launch checklist",
    status: "planned",
    leadEmail: "aria@keel.dev",
    startDate: "2026-08-01",
    targetDate: "2026-09-30",
    color: "#059669",
    createdAt: T0,
    updatedAt: T0,
  },
] as const;

const SECTIONS = ["Backlog", "Ready", "Doing", "Review", "Done"] as const;

/** Featured sections (board columns). */
export const FEATURED_SECTIONS = [
  ...SECTIONS.map((name, i) => ({
    id: `sec_api_${i}`,
    projectId: "proj_api",
    name,
    sortOrder: i,
  })),
  ...SECTIONS.map((name, i) => ({
    id: `sec_web_${i}`,
    projectId: "proj_web",
    name,
    sortOrder: i,
  })),
  ...SECTIONS.map((name, i) => ({
    id: `sec_launch_${i}`,
    projectId: "proj_launch",
    name,
    sortOrder: i,
  })),
] as const;

/** Featured tags. */
export const FEATURED_TAGS = [
  { id: "tag_bug", name: "bug", groupName: "type" },
  { id: "tag_feature", name: "feature", groupName: "type" },
  { id: "tag_customer", name: "customer", groupName: "source" },
  { id: "tag_design", name: "design", groupName: "area" },
] as const;

function task(row: {
  id: string;
  identifier: string;
  title: string;
  description: string;
  kind?: string;
  priority: number;
  estimate?: number | null;
  status: string;
  spaceId: string;
  projectId: string | null;
  sectionId: string | null;
  parentId?: string | null;
  dueDate?: string | null;
  completedAt?: string | null;
  archivedAt?: string | null;
  creatorEmail: string;
  roleNeeded?: string | null;
}) {
  return {
    kind: "task",
    estimate: null as number | null,
    parentId: null as string | null,
    startDate: null as string | null,
    dueDate: null as string | null,
    completedAt: null as string | null,
    archivedAt: null as string | null,
    roleNeeded: null as string | null,
    createdAt: T0,
    updatedAt: T0,
    ...row,
  };
}

/** Featured tasks (ENG-12 intake + Harbor graph). */
export const FEATURED_TASKS = [
  task({
    id: "tsk_eng_12",
    identifier: "ENG-12",
    title: "SSO login fails",
    description: "Customer cannot sign in after rotating the claim code.",
    priority: 1,
    estimate: 5,
    status: "doing",
    spaceId: "space_eng",
    projectId: "proj_api",
    sectionId: "sec_api_2",
    dueDate: "2026-08-08",
    creatorEmail: "aria@keel.dev",
    roleNeeded: "developer",
  }),
  task({
    id: "tsk_eng_13",
    identifier: "ENG-13",
    title: "Billing webhook",
    description: "Stripe → Harbor invoice settled.",
    priority: 2,
    estimate: 8,
    status: "doing",
    spaceId: "space_eng",
    projectId: "proj_api",
    sectionId: "sec_api_2",
    creatorEmail: "ben@keel.dev",
    roleNeeded: "developer",
  }),
  task({
    id: "tsk_eng_14",
    identifier: "ENG-14",
    title: "Checkout polish",
    description: "Blocked on billing webhook.",
    priority: 2,
    estimate: 5,
    status: "ready",
    spaceId: "space_eng",
    projectId: "proj_web",
    sectionId: "sec_web_1",
    creatorEmail: "eli@keel.dev",
    roleNeeded: "developer",
  }),
  task({
    id: "tsk_eng_10",
    identifier: "ENG-10",
    title: "API freeze",
    description: "No breaking changes after this date.",
    kind: "milestone",
    priority: 2,
    status: "ready",
    spaceId: "space_eng",
    projectId: "proj_api",
    sectionId: "sec_api_1",
    dueDate: "2026-08-20",
    creatorEmail: "aria@keel.dev",
    roleNeeded: "project_manager",
  }),
  task({
    id: "tsk_eng_9",
    identifier: "ENG-9",
    title: "Weekly launch review",
    description: "Recurring PM + eng sync.",
    priority: 3,
    status: "todo",
    spaceId: "space_gtm",
    projectId: "proj_launch",
    sectionId: "sec_launch_1",
    creatorEmail: "aria@keel.dev",
    roleNeeded: "project_manager",
  }),
  task({
    id: "tsk_des_4",
    identifier: "DES-4",
    title: "RTL checkout labels",
    description: "ملاحظة التصميم — identifiers stay LTR.",
    priority: 3,
    estimate: 3,
    status: "todo",
    spaceId: "space_des",
    projectId: "proj_web",
    sectionId: "sec_web_1",
    dueDate: "2026-08-10",
    creatorEmail: "cai@keel.dev",
  }),
  task({
    id: "tsk_eng_8",
    identifier: "ENG-8",
    title: "Replica lag banner",
    description: "Overdue — store browse showed stale rows.",
    priority: 1,
    estimate: 3,
    status: "todo",
    spaceId: "space_eng",
    projectId: "proj_web",
    sectionId: "sec_web_0",
    dueDate: "2026-08-01",
    creatorEmail: "eli@keel.dev",
    roleNeeded: "developer",
  }),
] as const;

/** Featured assignees. */
export const FEATURED_ASSIGNEES = [
  { id: "asg_1", taskId: "tsk_eng_12", assigneeEmail: "ben@keel.dev" },
  { id: "asg_2", taskId: "tsk_eng_13", assigneeEmail: "ben@keel.dev" },
  { id: "asg_3", taskId: "tsk_eng_14", assigneeEmail: "eli@keel.dev" },
  { id: "asg_4", taskId: "tsk_eng_8", assigneeEmail: "eli@keel.dev" },
  { id: "asg_5", taskId: "tsk_eng_9", assigneeEmail: "aria@keel.dev" },
] as const;

/** Featured followers. */
export const FEATURED_FOLLOWERS = [
  { id: "fol_1", taskId: "tsk_eng_12", followerEmail: "aria@keel.dev" },
  { id: "fol_2", taskId: "tsk_eng_13", followerEmail: "aria@keel.dev" },
] as const;

/** Featured dependencies — checkout blocked by billing webhook. */
export const FEATURED_DEPS = [
  { id: "dep_1", taskId: "tsk_eng_13", blocksTaskId: "tsk_eng_14" },
] as const;

/** Featured task tags. */
export const FEATURED_TASK_TAGS = [
  { id: "tt_1", taskId: "tsk_eng_12", tagId: "tag_bug" },
  { id: "tt_2", taskId: "tsk_eng_12", tagId: "tag_customer" },
  { id: "tt_3", taskId: "tsk_eng_14", tagId: "tag_feature" },
  { id: "tt_4", taskId: "tsk_des_4", tagId: "tag_design" },
] as const;

/** Featured custom field. */
export const FEATURED_FIELDS = [
  { id: "cf_role", projectId: "proj_api", name: "Role needed", type: "role" },
] as const;

/** Featured custom field values. */
export const FEATURED_FIELD_VALUES = [
  { id: "cfv_1", taskId: "tsk_eng_12", fieldId: "cf_role", value: "developer" },
] as const;

/** Featured comments. */
export const FEATURED_COMMENTS = [
  {
    id: "cmt_1",
    taskId: "tsk_eng_12",
    authorEmail: "aria@keel.dev",
    body: "Form intake — assign to a developer. @ben@keel.dev can you take this?",
    resolvedAt: null as string | null,
    createdAt: T0,
  },
  {
    id: "cmt_2",
    taskId: "tsk_eng_12",
    authorEmail: "ben@keel.dev",
    body: "Repro'd — session cleared after claim rotate.",
    resolvedAt: null,
    createdAt: T0 + 3_600_000,
  },
  {
    id: "cmt_3",
    taskId: "tsk_des_4",
    authorEmail: "cai@keel.dev",
    body: "ملاحظة التصميم — identifiers stay LTR inside RTL notes.",
    resolvedAt: null,
    createdAt: T0,
  },
] as const;

/** Featured documents. */
export const FEATURED_DOCUMENTS = [
  {
    id: "doc_prd_api",
    title: "Harbor API PRD",
    body: "SSO + billing webhook before freeze.",
    parentKind: "project",
    parentId: "proj_api",
    createdAt: T0,
  },
  {
    id: "doc_spec_12",
    title: "ENG-12 implementation spec",
    body: "Claim rotate must keep the session cookie.",
    parentKind: "task",
    parentId: "tsk_eng_12",
    createdAt: T0,
  },
] as const;

/** Featured project updates. */
export const FEATURED_UPDATES = [
  {
    id: "upd_web_1",
    projectId: "proj_web",
    health: "at_risk",
    body: "Checkout polish blocked on billing webhook.",
    authorEmail: "eli@keel.dev",
    createdAt: T0,
  },
] as const;

/** Featured views. */
export const FEATURED_VIEWS = [
  {
    id: "view_web_board",
    projectId: "proj_web",
    name: "Web board",
    kind: "board",
    filtersJson: "{}",
    ownerEmail: "aria@keel.dev",
    createdAt: T0,
  },
  {
    id: "view_api_list",
    projectId: "proj_api",
    name: "API list",
    kind: "list",
    filtersJson: "{}",
    ownerEmail: "ben@keel.dev",
    createdAt: T0,
  },
  {
    id: "view_launch_tl",
    projectId: "proj_launch",
    name: "Launch timeline",
    kind: "timeline",
    filtersJson: "{}",
    ownerEmail: "aria@keel.dev",
    createdAt: T0,
  },
] as const;

/** Featured form. */
export const FEATURED_FORMS = [
  {
    id: "form_customer",
    projectId: "proj_api",
    name: "Customer request",
    schemaJson: '{"title":"string","body":"string"}',
    createdAt: T0,
  },
] as const;

/** Featured form submission → ENG-12. */
export const FEATURED_SUBMISSIONS = [
  {
    id: "sub_1",
    formId: "form_customer",
    taskId: "tsk_eng_12",
    payloadJson: '{"title":"SSO login fails"}',
    customerName: "Harbor Logistics",
    createdAt: T0,
  },
] as const;

/** Featured inbox. */
export const FEATURED_INBOX = [
  {
    id: "inb_1",
    memberEmail: "aria@keel.dev",
    kind: "form-submitted",
    title: "Harbor Logistics",
    refId: "tsk_eng_12",
    readAt: null as string | null,
    createdAt: T0,
  },
  {
    id: "inb_2",
    memberEmail: "ben@keel.dev",
    kind: "task-assigned",
    title: "SSO login fails",
    refId: "tsk_eng_12",
    readAt: null,
    createdAt: T0,
  },
] as const;

/** Featured activity. */
export const FEATURED_ACTIVITY = [
  {
    id: "act_1",
    parentKind: "task",
    parentId: "tsk_eng_12",
    actorEmail: "aria@keel.dev",
    kind: "created",
    body: "SSO login fails",
    createdAt: T0,
  },
] as const;

/** Featured recurrence. */
export const FEATURED_RECURRENCE = [
  { id: "rec_1", taskId: "tsk_eng_9", every: "7d", nextAt: "2026-08-18T09:00:00Z" },
] as const;

/** Featured compose drafts. */
export const FEATURED_DRAFTS: ReadonlyArray<{
  key: string;
  value: unknown;
  ttl?: string;
}> = [
  {
    key: "ENG-12",
    value: { identifier: "ENG-12", title: "SSO login fails", expiresAt: "2026-08-14T01:00:00Z" },
    ttl: "2h",
  },
  {
    key: "ENG-14",
    value: { identifier: "ENG-14", title: "Checkout polish", expiresAt: "2026-08-14T01:10:00Z" },
    ttl: "45m",
  },
];

/** Featured due-date reminders. */
export const FEATURED_REMINDERS: ReadonlyArray<{
  key: string;
  value: unknown;
  ttl?: string;
}> = [
  {
    key: "ENG-8",
    value: { identifier: "ENG-8", until: "2026-08-15T12:00:00Z", reason: "overdue banner" },
    ttl: "12h",
  },
];

/** Featured outbound webhooks — Console `kv:webhooks` browse. */
export const FEATURED_WEBHOOKS: ReadonlyArray<{
  key: string;
  value: unknown;
  ttl?: string;
}> = [
  {
    key: "wh_billing",
    value: {
      url: "https://hooks.keel.dev/billing",
      events: ["invoice.settled", "task.created"],
    },
  },
  {
    key: "wh_slack",
    value: {
      url: "https://hooks.slack.com/services/T000/B000/KeelHarbor",
      events: ["task.overdue"],
    },
  },
];

/** 1×1 PNG so Files browse can preview a real image. */
export const SEED_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (ch) => ch.charCodeAt(0),
);

/** Featured file objects — one `keel` bucket, folders per job. */
export const FEATURED_FILES: ReadonlyArray<{
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
  {
    key: "documents/doc_prd_api/prd.md",
    originalName: "prd.md",
    data: "# Harbor API PRD\n\nSSO + billing webhook before freeze.\n",
  },
  {
    key: "documents/doc_spec_12/impl-spec.md",
    originalName: "impl-spec.md",
    data: "# ENG-12\n\nClaim rotate must keep the session cookie.\n",
  },
  { key: "avatars/mem_aria.png", originalName: "aria.png", data: SEED_PNG },
  { key: "avatars/mem_ben.png", originalName: "ben.png", data: SEED_PNG },
  {
    key: "projects/proj_api/brief.md",
    originalName: "brief.md",
    data: "# Harbor API\n\nLead: Ben. Target 2026-08-29.\n",
  },
  {
    key: "projects/proj_web/cover.png",
    originalName: "cover.png",
    data: SEED_PNG,
  },
  {
    key: "exports/harbor-ga.csv",
    originalName: "harbor-ga.csv",
    data: "identifier,title,status\nENG-12,SSO login fails,started\n",
  },
  {
    key: "forms/form_customer/intake.json",
    originalName: "intake.json",
    data: '{"title":"SSO login fails","body":"Form intake"}\n',
  },
];

/** Featured task index documents. */
export const FEATURED_INDEX: ReadonlyArray<{
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
