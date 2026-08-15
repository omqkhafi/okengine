/**
 * Deterministic high-volume tail — Console-scale Store browse.
 */

import {
  FEATURED_ACTIVITY,
  FEATURED_ASSIGNEES,
  FEATURED_COMMENTS,
  FEATURED_DEPS,
  FEATURED_DOCUMENTS,
  FEATURED_DRAFTS,
  FEATURED_FIELDS,
  FEATURED_FIELD_VALUES,
  FEATURED_FILES,
  FEATURED_FOLLOWERS,
  FEATURED_FORMS,
  FEATURED_GOALS,
  FEATURED_INBOX,
  FEATURED_INDEX,
  FEATURED_MEMBERS,
  FEATURED_PROJECTS,
  FEATURED_RECURRENCE,
  FEATURED_REMINDERS,
  FEATURED_SECTIONS,
  FEATURED_SPACES,
  FEATURED_SUBMISSIONS,
  FEATURED_TAGS,
  FEATURED_TASKS,
  FEATURED_TASK_TAGS,
  FEATURED_UPDATES,
  FEATURED_VIEWS,
} from "./featured.ts";

/** Extra generated volume on top of the featured Harbor story. */
export const GENERATED = {
  members: 12,
  projects: 8,
  sections: 24,
  tasks: 500,
  assignees: 420,
  followers: 80,
  deps: 50,
  taskTags: 400,
  comments: 220,
  documents: 20,
  submissions: 30,
  activity: 80,
  inbox: 40,
  views: 8,
  kvKeys: 40,
  files: 24,
  index: 44,
} as const;

const T0 = 1_753_920_000_000;

/** Task row matching `schema.decl` tasks. */
export type SeedTaskRow = {
  id: string;
  identifier: string;
  title: string;
  description: string;
  kind: string;
  priority: number;
  estimate: number | null;
  status: string;
  spaceId: string;
  projectId: string | null;
  sectionId: string | null;
  parentId: string | null;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  creatorEmail: string;
  roleNeeded: string | null;
  createdAt: number;
  updatedAt: number;
};

/** KV entry for drafts or reminders. */
export type SeedKvEntry = {
  key: string;
  value: unknown;
  ttl?: string;
};

/** File object + bucket payload. */
export type SeedFileEntry = {
  key: string;
  originalName: string;
  data: string;
};

/** Task index document. */
export type SeedIndexEntry = {
  id: string;
  vector: readonly number[];
  meta: Record<string, unknown>;
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

const TASK_TITLES = [
  "Fix flaky checkout hover",
  "Form intake persist",
  "Goal rollup copy",
  "Board column reorder",
  "Overdue banner on support tasks",
  "Subtask auto-complete parent",
  "Mention reply locale",
  "Draft TTL sweep",
  "Project health update",
  "Custom field for role",
  "Replica lag chip",
  "Index stale after rename",
  "Customer request attach",
  "Milestone progress rollup",
  "Inbox live comment",
  "Ask intake from Slack",
] as const;

const COMMENT_BODIES = [
  "Ship it — matches the spec.",
  "Need a screenshot before we accept.",
  "Moved to the next section.",
  "Blocked on the API freeze.",
  "ملاحظة المراجعة — keep identifiers LTR.",
  "Assignee swapped after intake.",
] as const;

const EXTRA_PEOPLE = [
  { id: "nora", name: "Nora Singh", spaceId: "space_eng", role: "developer" },
  { id: "omar", name: "Omar Haddad", spaceId: "space_eng", role: "developer" },
  { id: "priya", name: "Priya Shah", spaceId: "space_eng", role: "project_manager" },
  { id: "quin", name: "Quin Walsh", spaceId: "space_eng", role: "developer" },
  { id: "rosa", name: "Rosa Alvarez", spaceId: "space_eng", role: "member" },
  { id: "samir", name: "Samir Cole", spaceId: "space_eng", role: "developer" },
  { id: "tess", name: "Tess Nguyen", spaceId: "space_eng", role: "member" },
  { id: "uma", name: "Uma Berg", spaceId: "space_des", role: "member" },
  { id: "vik", name: "Vik Noor", spaceId: "space_des", role: "member" },
  { id: "wen", name: "Wen Li", spaceId: "space_des", role: "developer" },
  { id: "yael", name: "Yael Cohen", spaceId: "space_gtm", role: "project_manager" },
  { id: "zio", name: "Zio Hart", spaceId: "space_gtm", role: "guest" },
] as const;

const STATUSES = ["todo", "ready", "doing", "review", "done"] as const;
const ESTIMATES = [1, 2, 3, 5, 8, 13, null] as const;
const TAG_IDS = ["tag_bug", "tag_feature", "tag_customer", "tag_design"] as const;
const ROLES = ["developer", "project_manager", null] as const;

/**
 * Build the high-volume tail so Store browse looks like a live workspace.
 */
export function generateKeelVolume(): {
  readonly members: ReadonlyArray<{
    id: string;
    spaceId: string;
    name: string;
    email: string;
    role: string;
    createdAt: number;
  }>;
  readonly projects: ReadonlyArray<{
    id: string;
    spaceId: string;
    goalId: string;
    name: string;
    status: string;
    leadEmail: string;
    startDate: string | null;
    targetDate: string;
    color: string | null;
    createdAt: number;
    updatedAt: number;
  }>;
  readonly sections: ReadonlyArray<{
    id: string;
    projectId: string;
    name: string;
    sortOrder: number;
  }>;
  readonly tasks: readonly SeedTaskRow[];
  readonly assignees: ReadonlyArray<{ id: string; taskId: string; assigneeEmail: string }>;
  readonly followers: ReadonlyArray<{ id: string; taskId: string; followerEmail: string }>;
  readonly deps: ReadonlyArray<{ id: string; taskId: string; blocksTaskId: string }>;
  readonly taskTags: ReadonlyArray<{ id: string; taskId: string; tagId: string }>;
  readonly comments: ReadonlyArray<{
    id: string;
    taskId: string;
    authorEmail: string;
    body: string;
    resolvedAt: string | null;
    createdAt: number;
  }>;
  readonly documents: ReadonlyArray<{
    id: string;
    title: string;
    body: string;
    parentKind: string;
    parentId: string;
    createdAt: number;
  }>;
  readonly submissions: ReadonlyArray<{
    id: string;
    formId: string;
    taskId: string;
    payloadJson: string;
    customerName: string;
    createdAt: number;
  }>;
  readonly activity: ReadonlyArray<{
    id: string;
    parentKind: string;
    parentId: string;
    actorEmail: string;
    kind: string;
    body: string;
    createdAt: number;
  }>;
  readonly inbox: ReadonlyArray<{
    id: string;
    memberEmail: string;
    kind: string;
    title: string;
    refId: string;
    readAt: string | null;
    createdAt: number;
  }>;
  readonly views: ReadonlyArray<{
    id: string;
    projectId: string;
    name: string;
    kind: string;
    filtersJson: string;
    ownerEmail: string;
    createdAt: number;
  }>;
  readonly drafts: readonly SeedKvEntry[];
  readonly reminders: readonly SeedKvEntry[];
  readonly files: readonly SeedFileEntry[];
  readonly index: readonly SeedIndexEntry[];
} {
  const rand = mulberry32(0x6ee1_5eed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

  const members = EXTRA_PEOPLE.map((p) => ({
    id: `mem_${p.id}`,
    spaceId: p.spaceId,
    name: p.name,
    email: `${p.id}@keel.dev`,
    role: p.role,
    createdAt: T0,
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
    spaceId: pick(["space_eng", "space_des", "space_gtm"] as const),
    goalId: "goal_harbor",
    name: `${pick(["Inbox", "Agents", "Replay", "Access", "Vault", "Clock", "Forms", "Views"])} ${i + 1}`,
    status: pick(["backlog", "started", "completed"]),
    leadEmail: pick(emails),
    startDate: null as string | null,
    targetDate: `2026-0${(i % 9) + 1}-15`,
    color: null as string | null,
    createdAt: T0,
    updatedAt: T0,
  }));
  const projectIds = ["proj_api", "proj_web", "proj_launch", ...projects.map((p) => p.id), null];

  const sectionNames = ["Backlog", "Ready", "Doing"] as const;
  const sections = Array.from({ length: GENERATED.sections }, (_, i) => ({
    id: `sec_g_${i}`,
    projectId: projects[i % projects.length]!.id,
    name: sectionNames[i % sectionNames.length]!,
    sortOrder: i % 3,
  }));
  const sectionIds = [
    "sec_api_0",
    "sec_api_2",
    "sec_web_1",
    ...sections.map((s) => s.id),
    null,
  ];

  const tasks: SeedTaskRow[] = [];
  for (let i = 0; i < GENERATED.tasks; i += 1) {
    const roll = rand();
    const team = roll < 0.72 ? ("ENG" as const) : roll < 0.9 ? ("DES" as const) : ("GTM" as const);
    const n = 200 + i;
    const identifier = `${team}-${n}`;
    const title = `${pick(TASK_TITLES)} (${identifier})`;
    const rtl = rand() < 0.06;
    const isSub = i > 8 && rand() < 0.08;
    tasks.push({
      id: `tsk_${team.toLowerCase()}_${n}`,
      identifier,
      title,
      description: rtl
        ? `ملاحظة ${identifier} — ${title}`
        : `${title} filed from the lived-in keel backlog.`,
      kind: isSub ? "subtask" : rand() < 0.04 ? "milestone" : "task",
      priority: Math.floor(rand() * 5),
      estimate: pick(ESTIMATES),
      status: pick(STATUSES),
      spaceId: team === "ENG" ? "space_eng" : team === "DES" ? "space_des" : "space_gtm",
      projectId: pick(projectIds),
      sectionId: pick(sectionIds),
      parentId: isSub ? (tasks[i - 1 - Math.floor(rand() * 4)]?.id ?? null) : null,
      startDate: null,
      dueDate:
        rand() < 0.35 ? `2026-08-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}` : null,
      completedAt: rand() < 0.12 ? "2026-08-01T00:00:00Z" : null,
      archivedAt: rand() < 0.04 ? "2026-08-01T00:00:00Z" : null,
      creatorEmail: pick(emails),
      roleNeeded: pick(ROLES),
      createdAt: T0 + i * 1000,
      updatedAt: T0 + i * 1000,
    });
  }

  const assignees: Array<{ id: string; taskId: string; assigneeEmail: string }> = [];
  for (let i = 0; i < GENERATED.assignees; i += 1) {
    assignees.push({
      id: `asg_g_${i}`,
      taskId: tasks[i % tasks.length]!.id,
      assigneeEmail: pick(emails),
    });
  }

  const followers: Array<{ id: string; taskId: string; followerEmail: string }> = [];
  for (let i = 0; i < GENERATED.followers; i += 1) {
    followers.push({
      id: `fol_g_${i}`,
      taskId: tasks[i % tasks.length]!.id,
      followerEmail: pick(emails),
    });
  }

  const deps: Array<{ id: string; taskId: string; blocksTaskId: string }> = [];
  for (let i = 0; i < GENERATED.deps; i += 1) {
    const a = tasks[i]!;
    const b = tasks[i + 3] ?? tasks[0]!;
    if (a.id === b.id) continue;
    deps.push({ id: `dep_g_${i}`, taskId: a.id, blocksTaskId: b.id });
  }

  const taskTags: Array<{ id: string; taskId: string; tagId: string }> = [];
  for (let i = 0; i < GENERATED.taskTags; i += 1) {
    taskTags.push({
      id: `tt_g_${i}`,
      taskId: tasks[i % tasks.length]!.id,
      tagId: pick(TAG_IDS),
    });
  }

  const comments: Array<{
    id: string;
    taskId: string;
    authorEmail: string;
    body: string;
    resolvedAt: string | null;
    createdAt: number;
  }> = [];
  for (let i = 0; i < GENERATED.comments; i += 1) {
    const issue = tasks[Math.floor(rand() * tasks.length)]!;
    comments.push({
      id: `cmt_g_${i}`,
      taskId: issue.id,
      authorEmail: pick(emails),
      body: pick(COMMENT_BODIES),
      resolvedAt: null,
      createdAt: T0 + i,
    });
  }

  const documents = Array.from({ length: GENERATED.documents }, (_, i) => {
    const issue = tasks[i]!;
    return {
      id: `doc_g_${i}`,
      title: `Notes ${issue.identifier}`,
      body: `Working notes for ${issue.title}.`,
      parentKind: "task",
      parentId: issue.id,
      createdAt: T0,
    };
  });

  const customers = ["Harbor Logistics", "Atlas Labs", "Nova Retail", "Delta Health"];
  const submissions = Array.from({ length: GENERATED.submissions }, (_, i) => {
    const issue = tasks[tasks.length - 1 - i]!;
    return {
      id: `sub_g_${i}`,
      formId: "form_customer",
      taskId: issue.id,
      payloadJson: JSON.stringify({ title: issue.title }),
      customerName: pick(customers),
      createdAt: T0,
    };
  });

  const activity = Array.from({ length: GENERATED.activity }, (_, i) => {
    const issue = tasks[i]!;
    return {
      id: `act_g_${i}`,
      parentKind: "task",
      parentId: issue.id,
      actorEmail: pick(emails),
      kind: "created",
      body: issue.title,
      createdAt: T0,
    };
  });

  const inbox = Array.from({ length: GENERATED.inbox }, (_, i) => {
    const issue = tasks[i]!;
    return {
      id: `inb_g_${i}`,
      memberEmail: pick(emails),
      kind: "task-assigned",
      title: issue.title,
      refId: issue.id,
      readAt: null as string | null,
      createdAt: T0,
    };
  });

  const views = Array.from({ length: GENERATED.views }, (_, i) => ({
    id: `view_g_${i}`,
    projectId: projects[i % projects.length]!.id,
    name: `View ${i + 1}`,
    kind: pick(["list", "board", "timeline", "calendar"] as const),
    filtersJson: "{}",
    ownerEmail: pick(emails),
    createdAt: T0,
  }));

  const drafts: SeedKvEntry[] = [];
  const reminders: SeedKvEntry[] = [];
  const ttls = ["30m", "2h", "12h", "1d"] as const;
  for (let i = 0; i < GENERATED.kvKeys; i += 1) {
    const issue = tasks[i]!;
    const entry: SeedKvEntry = {
      key: issue.identifier,
      value: {
        identifier: issue.identifier,
        title: issue.title,
        expiresAt: "2026-08-14T02:00:00Z",
      },
      ...(i % 5 === 0 ? {} : { ttl: ttls[i % ttls.length] }),
    };
    if (i % 7 === 0) reminders.push(entry);
    else drafts.push(entry);
  }

  const files = Array.from({ length: GENERATED.files }, (_, i) => {
    const issue = tasks[i]!;
    return {
      key: `attachments/${issue.id}/note-${i}.txt`,
      originalName: `note-${i}.txt`,
      data: `bytes:${issue.identifier}`,
    };
  });

  const index = Array.from({ length: GENERATED.index }, (_, i) => {
    const issue = tasks[i]!;
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
    sections,
    tasks,
    assignees,
    followers,
    deps,
    taskTags,
    comments,
    documents,
    submissions,
    activity,
    inbox,
    views,
    drafts,
    reminders,
    files,
    index,
  };
}

/** Generated volume rows. */
export const KEEL_VOLUME = generateKeelVolume();

/** Seeded facet / table counts (verifiable in tests). */
export const KEEL_SEED_COUNTS = {
  spaces: FEATURED_SPACES.length,
  members: FEATURED_MEMBERS.length + KEEL_VOLUME.members.length,
  goals: FEATURED_GOALS.length,
  projects: FEATURED_PROJECTS.length + KEEL_VOLUME.projects.length,
  sections: FEATURED_SECTIONS.length + KEEL_VOLUME.sections.length,
  tags: FEATURED_TAGS.length,
  tasks: FEATURED_TASKS.length + KEEL_VOLUME.tasks.length,
  assignees: FEATURED_ASSIGNEES.length + KEEL_VOLUME.assignees.length,
  followers: FEATURED_FOLLOWERS.length + KEEL_VOLUME.followers.length,
  deps: FEATURED_DEPS.length + KEEL_VOLUME.deps.length,
  taskTags: FEATURED_TASK_TAGS.length + KEEL_VOLUME.taskTags.length,
  fields: FEATURED_FIELDS.length,
  fieldValues: FEATURED_FIELD_VALUES.length,
  comments: FEATURED_COMMENTS.length + KEEL_VOLUME.comments.length,
  documents: FEATURED_DOCUMENTS.length + KEEL_VOLUME.documents.length,
  updates: FEATURED_UPDATES.length,
  views: FEATURED_VIEWS.length + KEEL_VOLUME.views.length,
  forms: FEATURED_FORMS.length,
  submissions: FEATURED_SUBMISSIONS.length + KEEL_VOLUME.submissions.length,
  inbox: FEATURED_INBOX.length + KEEL_VOLUME.inbox.length,
  activity: FEATURED_ACTIVITY.length + KEEL_VOLUME.activity.length,
  recurrence: FEATURED_RECURRENCE.length,
  fileObjects: FEATURED_FILES.length + KEEL_VOLUME.files.length,
  drafts: FEATURED_DRAFTS.length + KEEL_VOLUME.drafts.length,
  reminders: FEATURED_REMINDERS.length + KEEL_VOLUME.reminders.length,
  index: FEATURED_INDEX.length + KEEL_VOLUME.index.length,
} as const;
