/**
 * Extra keel seed surface — full CRUD + custom routes beyond the featured
 * github → create → notify story. Spread into {@link UI_NEXT_SEEDED_MANIFEST}.
 *
 * Featured flow ids stay in `ui-next-seed-manifest.ts` and must not appear here.
 */

import type {
  ChannelMedium,
  Effects,
  Flow,
  JsonSchema,
  Manifest,
  SignalDelivery,
} from "../../manifest/types.ts";

const ID = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
} as const satisfies JsonSchema;

/** List / search input — query + pagination for Call API. */
export const KEEL_LIST_IN = {
  type: "object",
  properties: {
    q: { type: "string", description: "Search title, id, name" },
    teamKey: { type: "string", description: "Filter by team key (ENG)" },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 100,
      default: 25,
      description: "Page size",
    },
    offset: {
      type: "integer",
      minimum: 0,
      default: 0,
      description: "Skip this many rows",
    },
    cursor: { type: "string", description: "Page token (overrides offset)" },
    orderBy: { type: "string", default: "id", description: "Sort column" },
    order: {
      type: "string",
      enum: ["asc", "desc"],
      default: "asc",
      description: "Sort direction",
    },
  },
} as const satisfies JsonSchema;

/** List / search output — page of rows plus pagination. */
export const KEEL_LIST_OUT = {
  type: "object",
  required: ["items"],
  properties: {
    items: { type: "array", items: { type: "object" } },
    count: { type: "integer" },
    total: { type: "integer" },
    limit: { type: "integer" },
    offset: { type: "integer" },
    nextCursor: { type: "string" },
  },
} as const satisfies JsonSchema;

const OK = {
  type: "object",
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
} as const satisfies JsonSchema;

const MEMBER = ["member"] as const;
const ISSUE_WRITE = ["member", "issue:write", "issues.write"] as const;
const COMMENT_WRITE = ["member", "comment:write", "comments.write"] as const;
const PROJECT_ADMIN = ["member", "project:admin"] as const;
const FILES_WRITE = ["member", "issue:write", "files:write"] as const;
const TEAM_ADMIN = ["member", "team:admin"] as const;
const MEMBER_ADMIN = ["member", "member:admin"] as const;
const WEBHOOK_ADMIN = ["member", "webhook:admin"] as const;
const LABEL_WRITE = ["member", "issue:write", "labels.write"] as const;
const TRIAGE_ACCEPT = ["member", "triage:accept"] as const;

/**
 * Compact HTTP flow for the keel seed surface.
 *
 * @param spec - Method, path, gates, effects
 */
function httpFlow(spec: {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "QUERY";
  path: string;
  gates?: readonly string[];
  plane?: "user" | "operator";
  live?: boolean;
  durable?: boolean;
  cache?: boolean | string;
  in?: JsonSchema;
  out?: JsonSchema;
  errors?: string[];
  effects?: Effects;
  source: string;
}): Flow {
  return {
    trigger: { http: { method: spec.method, path: spec.path } },
    plane: spec.plane ?? "user",
    ...(spec.gates ? { gates: [...spec.gates] } : {}),
    ...(spec.live ? { live: true } : {}),
    ...(spec.durable ? { durable: true } : {}),
    ...(spec.cache !== undefined ? { cache: spec.cache } : {}),
    ...(spec.in ? { in: spec.in } : {}),
    ...(spec.out ? { out: spec.out } : {}),
    ...(spec.errors ? { errors: spec.errors } : {}),
    ...(spec.effects ? { effects: spec.effects } : {}),
    source: spec.source,
  };
}

/**
 * Standard list / get / create / update / delete for one SQL resource.
 *
 * @param spec - Unit, table, paths, which verbs to skip (already featured)
 */
function crud(spec: {
  unit: string;
  table: `sql:${string}`;
  collection: string;
  item: string;
  readGates?: readonly string[];
  writeGates?: readonly string[];
  skip?: readonly ("list" | "get" | "create" | "update" | "delete")[];
  liveList?: boolean;
  createIn?: JsonSchema;
  updateIn?: JsonSchema;
  createEmits?: readonly string[];
  sourceDir: string;
}): Record<string, Flow> {
  const skip = new Set(spec.skip ?? []);
  const read = spec.readGates ?? MEMBER;
  const write = spec.writeGates ?? MEMBER;
  const out: Record<string, Flow> = {};
  if (!skip.has("list")) {
    out[`${spec.unit}.list`] = httpFlow({
      method: "GET",
      path: spec.collection,
      gates: read,
      live: spec.liveList,
      in: KEEL_LIST_IN,
      out: KEEL_LIST_OUT,
      effects: { reads: [spec.table] },
      source: `${spec.sourceDir}/list.ts:4`,
    });
  }
  if (!skip.has("get")) {
    out[`${spec.unit}.get`] = httpFlow({
      method: "GET",
      path: spec.item,
      gates: read,
      cache: "30s",
      out: ID,
      errors: ["NotFound"],
      effects: { reads: [spec.table] },
      source: `${spec.sourceDir}/get.ts:4`,
    });
  }
  if (!skip.has("create")) {
    out[`${spec.unit}.create`] = httpFlow({
      method: "POST",
      path: spec.collection,
      gates: write,
      in: spec.createIn ?? ID,
      out: ID,
      errors: ["Duplicate"],
      effects: {
        reads: [spec.table],
        writes: [spec.table],
        ...(spec.createEmits ? { emits: [...spec.createEmits] } : {}),
      },
      source: `${spec.sourceDir}/create.ts:4`,
    });
  }
  if (!skip.has("update")) {
    out[`${spec.unit}.update`] = httpFlow({
      method: "PATCH",
      path: spec.item,
      gates: write,
      in: spec.updateIn ?? ID,
      out: ID,
      errors: ["NotFound"],
      effects: { reads: [spec.table], writes: [spec.table] },
      source: `${spec.sourceDir}/update.ts:4`,
    });
  }
  if (!skip.has("delete")) {
    out[`${spec.unit}.delete`] = httpFlow({
      method: "DELETE",
      path: spec.item,
      gates: write,
      out: OK,
      errors: ["NotFound"],
      effects: { reads: [spec.table], writes: [spec.table] },
      source: `${spec.sourceDir}/delete.ts:4`,
    });
  }
  return out;
}

const ISSUE_TITLE = {
  type: "object",
  required: ["title"],
  properties: { title: { type: "string" } },
} as const satisfies JsonSchema;

const ASSIGN_IN = {
  type: "object",
  required: ["assigneeEmail"],
  properties: { assigneeEmail: { type: "string" } },
} as const satisfies JsonSchema;

const LABEL_IN = {
  type: "object",
  required: ["labelId"],
  properties: { labelId: { type: "string" } },
} as const satisfies JsonSchema;

const MOVE_IN = {
  type: "object",
  required: ["teamKey"],
  properties: {
    teamKey: { type: "string" },
    projectId: { type: "string" },
    cycleId: { type: "string" },
  },
} as const satisfies JsonSchema;

const MERGE_IN = {
  type: "object",
  required: ["intoId"],
  properties: { intoId: { type: "string" } },
} as const satisfies JsonSchema;

const SNOOZE_IN = {
  type: "object",
  required: ["until"],
  properties: { until: { type: "string" }, reason: { type: "string" } },
} as const satisfies JsonSchema;

const COMMENT_IN = {
  type: "object",
  required: ["body"],
  properties: { body: { type: "string" } },
} as const satisfies JsonSchema;

const SEARCH_IN = {
  type: "object",
  required: ["q"],
  properties: {
    ...KEEL_LIST_IN.properties,
    q: { type: "string", description: "Search title, id, name" },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 50,
      default: 25,
      description: "Page size",
    },
  },
} as const satisfies JsonSchema;

const DRAFT_IN = {
  type: "object",
  required: ["title"],
  properties: { title: { type: "string" }, body: { type: "string" } },
} as const satisfies JsonSchema;

/**
 * Additional Manifest flows — CRUD for every keel resource plus Linear-shaped
 * custom routes (archive, assign, merge, triage snooze, QUERY search, …).
 */
export const KEEL_SURFACE_FLOWS: Record<string, Flow> = {
  ...crud({
    unit: "issues",
    table: "sql:issues",
    collection: "/issues",
    item: "/issues/:id",
    readGates: MEMBER,
    writeGates: ISSUE_WRITE,
    skip: ["list", "create", "update"],
    sourceDir: "src/flows/issues",
  }),
  "issues.archive": httpFlow({
    method: "POST",
    path: "/issues/:id/archive",
    gates: ISSUE_WRITE,
    out: OK,
    errors: ["NotFound"],
    effects: { reads: ["sql:issues"], writes: ["sql:issues"], emits: ["issue-archived"] },
    source: "src/flows/issues/archive.ts:4",
  }),
  "issues.unarchive": httpFlow({
    method: "POST",
    path: "/issues/:id/unarchive",
    gates: ISSUE_WRITE,
    out: OK,
    errors: ["NotFound"],
    effects: { reads: ["sql:issues"], writes: ["sql:issues"] },
    source: "src/flows/issues/unarchive.ts:4",
  }),
  "issues.assign": httpFlow({
    method: "POST",
    path: "/issues/:id/assign",
    gates: ISSUE_WRITE,
    in: ASSIGN_IN,
    out: ID,
    errors: ["NotFound"],
    effects: {
      reads: ["sql:issues", "sql:members"],
      writes: ["sql:issues"],
      emits: ["issue-reassigned"],
      sends: ["issue-assigned"],
    },
    source: "src/flows/issues/assign.ts:6",
  }),
  "issues.subscribe": httpFlow({
    method: "POST",
    path: "/issues/:id/subscribe",
    gates: MEMBER,
    out: OK,
    effects: { reads: ["sql:issues"], sends: ["issue-subscribed"] },
    source: "src/flows/issues/subscribe.ts:4",
  }),
  "issues.unsubscribe": httpFlow({
    method: "POST",
    path: "/issues/:id/unsubscribe",
    gates: MEMBER,
    out: OK,
    effects: { reads: ["sql:issues"] },
    source: "src/flows/issues/unsubscribe.ts:4",
  }),
  "issues.duplicate": httpFlow({
    method: "POST",
    path: "/issues/:id/duplicate",
    gates: ISSUE_WRITE,
    out: ID,
    errors: ["NotFound"],
    effects: {
      reads: ["sql:issues"],
      writes: ["sql:issues"],
      emits: ["issue-created"],
      calls: ["issues.create"],
    },
    source: "src/flows/issues/duplicate.ts:8",
  }),
  "issues.move": httpFlow({
    method: "POST",
    path: "/issues/:id/move",
    gates: ISSUE_WRITE,
    in: MOVE_IN,
    out: ID,
    errors: ["NotFound", "CycleClosed"],
    effects: { reads: ["sql:issues", "sql:cycles"], writes: ["sql:issues"] },
    source: "src/flows/issues/move.ts:6",
  }),
  "issues.transfer": httpFlow({
    method: "POST",
    path: "/issues/:id/transfer",
    gates: ISSUE_WRITE,
    in: MOVE_IN,
    out: ID,
    errors: ["NotFound"],
    effects: { reads: ["sql:issues", "sql:teams"], writes: ["sql:issues"] },
    source: "src/flows/issues/transfer.ts:6",
  }),
  "issues.merge": httpFlow({
    method: "POST",
    path: "/issues/:id/merge",
    gates: ISSUE_WRITE,
    in: MERGE_IN,
    out: ID,
    errors: ["NotFound", "Duplicate"],
    effects: { reads: ["sql:issues"], writes: ["sql:issues"], emits: ["issue-archived"] },
    source: "src/flows/issues/merge.ts:8",
  }),
  "issues.snooze": httpFlow({
    method: "POST",
    path: "/issues/:id/snooze",
    gates: ISSUE_WRITE,
    in: SNOOZE_IN,
    out: OK,
    effects: { reads: ["sql:issues"], writes: ["kv:triage-snooze"] },
    source: "src/flows/issues/snooze.ts:5",
  }),
  "issues.addLabel": httpFlow({
    method: "POST",
    path: "/issues/:id/labels",
    gates: ISSUE_WRITE,
    in: LABEL_IN,
    out: OK,
    errors: ["NotFound"],
    effects: { reads: ["sql:issues", "sql:labels"], writes: ["sql:issue_labels"] },
    source: "src/flows/issues/add-label.ts:4",
  }),
  "issues.removeLabel": httpFlow({
    method: "DELETE",
    path: "/issues/:id/labels/:labelId",
    gates: ISSUE_WRITE,
    out: OK,
    errors: ["NotFound"],
    effects: { reads: ["sql:issue_labels"], writes: ["sql:issue_labels"] },
    source: "src/flows/issues/remove-label.ts:4",
  }),
  "issues.reserveIdentifier": {
    plane: "user",
    effects: { reads: ["sql:issues", "sql:teams"], writes: ["sql:issues"] },
    source: "src/flows/issues/reserve.ts:3",
  },
  "issues.applyWorkflow": {
    plane: "user",
    effects: { reads: ["sql:issues", "sql:workflow_states"], writes: ["sql:issues"] },
    source: "src/flows/issues/workflow.ts:3",
  },
  "issues.onAssignee": {
    trigger: { cdc: { table: "issues", column: "assignee_email" } },
    plane: "operator",
    effects: { reads: ["sql:issues"], emits: ["issue-reassigned"], sends: ["issue-assigned"] },
    source: "src/flows/issues/cdc-assignee.ts:3",
  },

  ...crud({
    unit: "comments",
    table: "sql:comments",
    collection: "/issues/:id/comments",
    item: "/comments/:id",
    readGates: MEMBER,
    writeGates: COMMENT_WRITE,
    skip: ["create"],
    liveList: true,
    updateIn: COMMENT_IN,
    sourceDir: "src/flows/comments",
  }),
  "comments.resolve": httpFlow({
    method: "POST",
    path: "/comments/:id/resolve",
    gates: COMMENT_WRITE,
    out: OK,
    effects: { reads: ["sql:comments"], writes: ["sql:comments"], emits: ["comment-resolved"] },
    source: "src/flows/comments/resolve.ts:4",
  }),
  "comments.unresolve": httpFlow({
    method: "POST",
    path: "/comments/:id/unresolve",
    gates: COMMENT_WRITE,
    out: OK,
    effects: { reads: ["sql:comments"], writes: ["sql:comments"] },
    source: "src/flows/comments/unresolve.ts:4",
  }),

  ...crud({
    unit: "projects",
    table: "sql:projects",
    collection: "/projects",
    item: "/projects/:id",
    readGates: MEMBER,
    writeGates: PROJECT_ADMIN,
    skip: ["create"],
    liveList: true,
    sourceDir: "src/flows/projects",
  }),
  "projects.archive": httpFlow({
    method: "POST",
    path: "/projects/:id/archive",
    gates: PROJECT_ADMIN,
    out: OK,
    effects: { reads: ["sql:projects"], writes: ["sql:projects"], emits: ["project-updated"] },
    source: "src/flows/projects/archive.ts:4",
  }),
  "projects.postUpdate": httpFlow({
    method: "POST",
    path: "/projects/:id/updates",
    gates: PROJECT_ADMIN,
    in: { type: "object", required: ["body"], properties: { body: { type: "string" } } },
    out: ID,
    effects: {
      reads: ["sql:projects"],
      writes: ["sql:project_updates"],
      emits: ["project-updated"],
      sends: ["project-update"],
    },
    source: "src/flows/projects/post-update.ts:6",
  }),
  "projects.listUpdates": httpFlow({
    method: "GET",
    path: "/projects/:id/updates",
    gates: MEMBER,
    in: KEEL_LIST_IN,
    out: KEEL_LIST_OUT,
    effects: { reads: ["sql:project_updates"] },
    source: "src/flows/projects/list-updates.ts:4",
  }),
  "projects.listMilestones": httpFlow({
    method: "GET",
    path: "/projects/:id/milestones",
    gates: MEMBER,
    in: KEEL_LIST_IN,
    out: KEEL_LIST_OUT,
    effects: { reads: ["sql:project_milestones"] },
    source: "src/flows/projects/list-milestones.ts:4",
  }),
  "projects.addMilestone": httpFlow({
    method: "POST",
    path: "/projects/:id/milestones",
    gates: PROJECT_ADMIN,
    in: ISSUE_TITLE,
    out: ID,
    effects: { reads: ["sql:projects"], writes: ["sql:project_milestones"] },
    source: "src/flows/projects/add-milestone.ts:4",
  }),
  "projects.updateMilestone": httpFlow({
    method: "PATCH",
    path: "/projects/:id/milestones/:mid",
    gates: PROJECT_ADMIN,
    in: ISSUE_TITLE,
    out: ID,
    effects: { reads: ["sql:project_milestones"], writes: ["sql:project_milestones"] },
    source: "src/flows/projects/update-milestone.ts:4",
  }),
  "projects.onHealth": {
    trigger: { cdc: { table: "project_updates", column: "health" } },
    plane: "operator",
    effects: {
      reads: ["sql:project_updates"],
      emits: ["project-updated"],
      sends: ["project-update"],
    },
    source: "src/flows/projects/cdc-health.ts:3",
  },

  ...crud({
    unit: "documents",
    table: "sql:documents",
    collection: "/documents",
    item: "/documents/:id",
    readGates: MEMBER,
    writeGates: MEMBER,
    skip: ["create"],
    sourceDir: "src/flows/documents",
  }),
  "documents.duplicate": httpFlow({
    method: "POST",
    path: "/documents/:id/duplicate",
    gates: MEMBER,
    out: ID,
    effects: { reads: ["sql:documents"], writes: ["sql:documents"] },
    source: "src/flows/documents/duplicate.ts:4",
  }),
  "documents.summarize": httpFlow({
    method: "POST",
    path: "/documents/:id/summarize",
    gates: MEMBER,
    out: { type: "object", required: ["summary"], properties: { summary: { type: "string" } } },
    effects: { reads: ["sql:documents"], secrets: ["OPENAI_KEY"], asks: ["document-summary"] },
    source: "src/flows/documents/summarize.ts:6",
  }),

  ...crud({
    unit: "attachments",
    table: "sql:file_objects",
    collection: "/issues/:id/attachments",
    item: "/attachments/:id",
    readGates: MEMBER,
    writeGates: FILES_WRITE,
    skip: ["create", "delete"],
    sourceDir: "src/flows/attachments",
  }),
  "attachments.delete": httpFlow({
    method: "DELETE",
    path: "/attachments/:id",
    gates: FILES_WRITE,
    out: OK,
    effects: { reads: ["sql:file_objects"], writes: ["sql:file_objects", "files:attachments"] },
    source: "src/flows/attachments/delete.ts:4",
  }),

  ...crud({
    unit: "teams",
    table: "sql:teams",
    collection: "/teams",
    item: "/teams/:id",
    readGates: MEMBER,
    writeGates: TEAM_ADMIN,
    liveList: true,
    createIn: {
      type: "object",
      required: ["key", "name"],
      properties: { key: { type: "string" }, name: { type: "string" } },
    },
    sourceDir: "src/flows/teams",
  }),

  ...crud({
    unit: "labels",
    table: "sql:labels",
    collection: "/labels",
    item: "/labels/:id",
    readGates: MEMBER,
    writeGates: LABEL_WRITE,
    createIn: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" }, groupName: { type: "string" } },
    },
    sourceDir: "src/flows/labels",
  }),

  ...crud({
    unit: "cycles",
    table: "sql:cycles",
    collection: "/cycles",
    item: "/cycles/:id",
    readGates: MEMBER,
    writeGates: TEAM_ADMIN,
    sourceDir: "src/flows/cycles",
  }),
  "cycles.complete": httpFlow({
    method: "POST",
    path: "/cycles/:id/close",
    gates: TEAM_ADMIN,
    out: OK,
    errors: ["CycleClosed"],
    effects: {
      reads: ["sql:cycles", "sql:issues"],
      writes: ["sql:cycles", "sql:issues"],
      emits: ["cycle-closed"],
      calls: ["cycles.close"],
    },
    source: "src/flows/cycles/complete.ts:8",
  }),

  ...crud({
    unit: "members",
    table: "sql:members",
    collection: "/members",
    item: "/members/:id",
    readGates: MEMBER,
    writeGates: MEMBER_ADMIN,
    skip: ["create"],
    sourceDir: "src/flows/members",
  }),
  "members.invite": httpFlow({
    method: "POST",
    path: "/members/invite",
    gates: MEMBER_ADMIN,
    in: {
      type: "object",
      required: ["email", "role"],
      properties: {
        email: { type: "string" },
        role: { type: "string" },
        teamId: { type: "string" },
      },
    },
    out: ID,
    effects: { reads: ["sql:teams"], writes: ["sql:members"], emits: ["member-joined"] },
    source: "src/flows/members/invite.ts:6",
  }),

  ...crud({
    unit: "initiatives",
    table: "sql:initiatives",
    collection: "/initiatives",
    item: "/initiatives/:id",
    readGates: MEMBER,
    writeGates: PROJECT_ADMIN,
    createIn: ISSUE_TITLE,
    sourceDir: "src/flows/initiatives",
  }),

  ...crud({
    unit: "requests",
    table: "sql:customer_requests",
    collection: "/customer-requests",
    item: "/customer-requests/:id",
    readGates: MEMBER,
    writeGates: MEMBER,
    createIn: {
      type: "object",
      required: ["issueId", "body"],
      properties: {
        issueId: { type: "string" },
        customerName: { type: "string" },
        body: { type: "string" },
      },
    },
    sourceDir: "src/flows/requests",
  }),

  "triage.inbox": httpFlow({
    method: "GET",
    path: "/triage",
    gates: MEMBER,
    live: true,
    in: KEEL_LIST_IN,
    out: KEEL_LIST_OUT,
    effects: { reads: ["sql:issues", "kv:triage-snooze"] },
    source: "src/flows/triage/inbox.ts:4",
  }),
  "triage.snooze": httpFlow({
    method: "POST",
    path: "/triage/:id/snooze",
    gates: MEMBER,
    in: SNOOZE_IN,
    out: OK,
    effects: { reads: ["sql:issues"], writes: ["kv:triage-snooze"] },
    source: "src/flows/triage/snooze.ts:5",
  }),
  "triage.decline": httpFlow({
    method: "POST",
    path: "/triage/:id/decline",
    gates: TRIAGE_ACCEPT,
    out: OK,
    effects: { reads: ["sql:issues"], writes: ["sql:issues"] },
    source: "src/flows/triage/decline.ts:4",
  }),
  "triage.claim": httpFlow({
    method: "POST",
    path: "/triage/:id/claim",
    gates: TRIAGE_ACCEPT,
    out: ID,
    effects: { reads: ["sql:issues"], writes: ["sql:issues"], emits: ["issue-reassigned"] },
    source: "src/flows/triage/claim.ts:4",
  }),

  "search.query": httpFlow({
    method: "QUERY",
    path: "/search",
    gates: MEMBER,
    in: SEARCH_IN,
    out: KEEL_LIST_OUT,
    effects: { reads: ["index:issues", "sql:issues"], secrets: ["PUBLIC_DOCS_URL"] },
    source: "src/flows/search/query.ts:6",
  }),
  "search.suggest": httpFlow({
    method: "GET",
    path: "/search/suggest",
    gates: MEMBER,
    cache: "15s",
    in: KEEL_LIST_IN,
    out: KEEL_LIST_OUT,
    effects: { reads: ["index:issues"] },
    source: "src/flows/search/suggest.ts:4",
  }),
  "search.reindex": httpFlow({
    method: "POST",
    path: "/search/reindex",
    plane: "operator",
    gates: MEMBER,
    durable: true,
    out: OK,
    effects: { reads: ["sql:issues"], writes: ["index:issues"], calls: ["search.embedIssue"] },
    source: "src/flows/search/reindex.ts:8",
  }),
  "search.onUpdated": {
    trigger: { signal: "issue-updated" },
    plane: "operator",
    effects: { reads: ["sql:issues"], writes: ["index:issues"] },
    source: "src/flows/search/on-updated.ts:4",
  },
  "search.onComment": {
    trigger: { signal: "comment-added" },
    plane: "operator",
    effects: { reads: ["sql:comments"], writes: ["index:issues"] },
    source: "src/flows/search/on-comment.ts:4",
  },
  "search.embedIssue": {
    plane: "operator",
    effects: { reads: ["sql:issues"], writes: ["index:issues"], secrets: ["OPENAI_KEY"] },
    source: "src/flows/search/embed.ts:3",
  },

  "github.status": httpFlow({
    method: "GET",
    path: "/integrations/github",
    gates: MEMBER,
    out: {
      type: "object",
      required: ["connected"],
      properties: { connected: { type: "boolean" }, repo: { type: "string" } },
    },
    effects: { secrets: ["GITHUB_TOKEN"] },
    source: "src/flows/github/status.ts:4",
  }),
  "github.disconnect": httpFlow({
    method: "DELETE",
    path: "/integrations/github",
    gates: TEAM_ADMIN,
    out: OK,
    effects: { secrets: ["GITHUB_TOKEN"] },
    source: "src/flows/github/disconnect.ts:4",
  }),
  "github.sync": httpFlow({
    method: "POST",
    path: "/integrations/github/sync",
    gates: MEMBER,
    durable: true,
    out: OK,
    effects: { secrets: ["GITHUB_TOKEN"], calls: ["issues.create"] },
    source: "src/flows/github/sync.ts:8",
  }),
  "github.reconcile": {
    trigger: { cron: "0 */6 * * *" },
    plane: "operator",
    effects: { secrets: ["GITHUB_TOKEN"], calls: ["github.sync"] },
    source: "src/flows/github/reconcile.ts:5",
  },

  "drafts.list": httpFlow({
    method: "GET",
    path: "/drafts",
    gates: MEMBER,
    in: KEEL_LIST_IN,
    out: KEEL_LIST_OUT,
    effects: { reads: ["kv:drafts"] },
    source: "src/flows/drafts/list.ts:4",
  }),
  "drafts.save": httpFlow({
    method: "PUT",
    path: "/drafts/:id",
    gates: MEMBER,
    in: DRAFT_IN,
    out: ID,
    effects: { writes: ["kv:drafts"] },
    source: "src/flows/drafts/save.ts:4",
  }),
  "drafts.discard": httpFlow({
    method: "DELETE",
    path: "/drafts/:id",
    gates: MEMBER,
    out: OK,
    effects: { writes: ["kv:drafts"] },
    source: "src/flows/drafts/discard.ts:4",
  }),

  "webhooks.list": httpFlow({
    method: "GET",
    path: "/webhooks",
    gates: WEBHOOK_ADMIN,
    in: KEEL_LIST_IN,
    out: KEEL_LIST_OUT,
    effects: { secrets: ["WEBHOOK_SECRET"] },
    source: "src/flows/webhooks/list.ts:4",
  }),
  "webhooks.create": httpFlow({
    method: "POST",
    path: "/webhooks",
    gates: WEBHOOK_ADMIN,
    in: {
      type: "object",
      required: ["url"],
      properties: { url: { type: "string" }, events: { type: "array", items: { type: "string" } } },
    },
    out: ID,
    effects: { secrets: ["WEBHOOK_SECRET"] },
    source: "src/flows/webhooks/create.ts:6",
  }),
  "webhooks.delete": httpFlow({
    method: "DELETE",
    path: "/webhooks/:id",
    gates: WEBHOOK_ADMIN,
    out: OK,
    effects: { secrets: ["WEBHOOK_SECRET"] },
    source: "src/flows/webhooks/delete.ts:4",
  }),
  "webhooks.rotate": httpFlow({
    method: "POST",
    path: "/webhooks/:id/rotate",
    gates: WEBHOOK_ADMIN,
    out: OK,
    effects: { secrets: ["WEBHOOK_SECRET"] },
    source: "src/flows/webhooks/rotate.ts:4",
  }),

  "slack.ingest": httpFlow({
    method: "POST",
    path: "/integrations/slack",
    gates: MEMBER,
    durable: true,
    in: {
      type: "object",
      required: ["text"],
      properties: { text: { type: "string" }, channel: { type: "string" } },
    },
    out: ID,
    effects: { secrets: ["SLACK_BOT"], calls: ["issues.create"] },
    source: "src/flows/slack/ingest.ts:8",
  }),

  "health.ping": httpFlow({
    method: "HEAD",
    path: "/health",
    plane: "operator",
    gates: MEMBER,
    out: OK,
    effects: { secrets: ["PUBLIC_API_URL"] },
    source: "src/flows/health/ping.ts:2",
  }),

  "notify.onUpdated": {
    trigger: { signal: "issue-updated" },
    plane: "user",
    effects: { reads: ["sql:issues"], sends: ["issue-assigned"] },
    source: "src/flows/notify/on-updated.ts:4",
  },
  "notify.onArchived": {
    trigger: { signal: "issue-archived" },
    plane: "user",
    effects: { reads: ["sql:issues"], sends: ["project-update"] },
    source: "src/flows/notify/on-archived.ts:4",
  },
  "notify.onAssigned": {
    trigger: { signal: "issue-reassigned" },
    plane: "user",
    effects: { reads: ["sql:issues"], sends: ["issue-assigned"] },
    source: "src/flows/notify/on-assigned.ts:4",
  },
  "notify.onProject": {
    trigger: { signal: "project-updated" },
    plane: "user",
    effects: { reads: ["sql:projects"], sends: ["project-update"] },
    source: "src/flows/notify/on-project.ts:4",
  },
  "notify.onMember": {
    trigger: { signal: "member-joined" },
    plane: "user",
    effects: { reads: ["sql:members"], sends: ["daily-digest"] },
    source: "src/flows/notify/on-member.ts:4",
  },

  "digest.daily": {
    trigger: { cron: "0 8 * * *" },
    plane: "operator",
    effects: {
      reads: ["sql:issues", "sql:cycles"],
      asks: ["cycle-summary"],
      sends: ["daily-digest"],
      secrets: ["SLACK_WEBHOOK"],
    },
    source: "src/flows/digest/daily.ts:6",
  },
  "stale.nudge": {
    trigger: { every: "1h" },
    plane: "operator",
    effects: { reads: ["sql:issues"], sends: ["sla-alert"] },
    source: "src/flows/stale/nudge.ts:5",
  },
};

/**
 * Extra signals for the expanded keel surface.
 */
export const KEEL_SURFACE_SIGNALS: NonNullable<Manifest["signals"]> = {
  "issue-updated": {
    delivery: "once" satisfies SignalDelivery,
    retries: 3,
    deadLetter: true,
    description: "Issue fields changed — wake search + notify",
  },
  "issue-archived": {
    delivery: "broadcast" satisfies SignalDelivery,
    retries: 3,
    deadLetter: true,
    description: "Issue archived or merged away",
  },
  "issue-reassigned": {
    delivery: "live" satisfies SignalDelivery,
    retries: 3,
    deadLetter: true,
    description: "Assignee changed — realtime inbox",
  },
  "project-updated": {
    delivery: "broadcast" satisfies SignalDelivery,
    retries: 3,
    deadLetter: true,
    description: "Project health or archive changed",
  },
  "comment-resolved": {
    delivery: "once" satisfies SignalDelivery,
    retries: 3,
    deadLetter: true,
    description: "Thread marked resolved",
  },
  "member-joined": {
    delivery: "broadcast" satisfies SignalDelivery,
    retries: 3,
    deadLetter: true,
    description: "Workspace invite accepted",
  },
};

/**
 * Extra clocks for digest / stale / GitHub reconcile.
 */
export const KEEL_SURFACE_CLOCKS: NonNullable<Manifest["clocks"]> = {
  "daily-digest": {
    cron: "0 8 * * *",
    timezone: "UTC",
    description: "Morning cycle + inbox digest",
  },
  "nudge-stale": {
    every: "1h",
    timezone: "UTC",
    description: "Nudge issues idle past SLA warn",
  },
  "reconcile-github": {
    cron: "0 */6 * * *",
    timezone: "UTC",
    description: "Reconcile GitHub Issues drift",
  },
};

/**
 * Extra gates for the expanded write surface.
 */
export const KEEL_SURFACE_GATES: NonNullable<Manifest["gates"]> = {
  "team:admin": {
    kind: "policy",
    description: "May create teams and close cycles",
    scopes: ["team:admin"],
  },
  "comment:write": {
    kind: "policy",
    description: "May edit and resolve comments",
    scopes: ["comment:write"],
  },
  "files:write": {
    kind: "policy",
    description: "May replace or delete attachments",
    scopes: ["files:write"],
  },
  "member:admin": {
    kind: "policy",
    description: "May invite and remove members",
    scopes: ["member:admin"],
  },
  "webhook:admin": {
    kind: "policy",
    description: "May manage outbound webhooks",
    scopes: ["webhook:admin"],
  },
  "comments.write": {
    kind: "rate",
    strategy: "sliding-window-counter",
    max: 120,
    per: "1m",
    keyBy: "user",
    description: "Comment write throttle",
  },
  "labels.write": {
    kind: "rate",
    strategy: "token-bucket",
    max: 40,
    per: "1m",
    keyBy: "user",
    description: "Label mutation throttle",
  },
};

/**
 * Extra vault contracts used by webhooks / Slack ingest.
 */
export const KEEL_SURFACE_VAULT: NonNullable<Manifest["vault"]> = {
  WEBHOOK_SECRET: { description: "Outbound webhook HMAC signing key", rotate: "never" },
  SLACK_BOT: { description: "Slack ask-intake bot token", rotate: "90d" },
};

/**
 * Extra channel templates.
 */
export const KEEL_SURFACE_CHANNELS: NonNullable<Manifest["channels"]> = {
  "issue-subscribed": {
    medium: "email" satisfies ChannelMedium,
    locales: ["en"],
    description: "New subscriber confirmation",
  },
  "daily-digest": {
    medium: "email" satisfies ChannelMedium,
    locales: ["en", "ar"],
    description: "Morning inbox + cycle digest",
  },
  "comment-resolved": {
    medium: "push" satisfies ChannelMedium,
    locales: ["en"],
    description: "Thread resolved",
  },
};
