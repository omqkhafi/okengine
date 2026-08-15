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
    spaceKey: { type: "string", description: "Filter by space key (ENG)" },
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
const TASK_WRITE = ["member", "task:write"] as const;
const COMMENT_WRITE = ["member", "comment:write"] as const;
const PROJECT_ADMIN = ["member", "project:admin"] as const;
const FILES_WRITE = ["member", "task:write", "files:write"] as const;
const MEMBER_ADMIN = ["member", "member:admin"] as const;
const WEBHOOK_ADMIN = ["member", "webhook:admin"] as const;

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

const TITLE_IN = {
  type: "object",
  required: ["title"],
  properties: { title: { type: "string" } },
} as const satisfies JsonSchema;

const ASSIGN_IN = {
  type: "object",
  required: ["assigneeEmail"],
  properties: { assigneeEmail: { type: "string" } },
} as const satisfies JsonSchema;

const TAG_IN = {
  type: "object",
  required: ["tagId"],
  properties: { tagId: { type: "string" } },
} as const satisfies JsonSchema;

const MOVE_IN = {
  type: "object",
  required: ["spaceKey"],
  properties: {
    spaceKey: { type: "string" },
    projectId: { type: "string" },
    sectionId: { type: "string" },
  },
} as const satisfies JsonSchema;

const DEPEND_IN = {
  type: "object",
  required: ["blocksTaskId"],
  properties: { blocksTaskId: { type: "string" } },
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
 * Additional Manifest flows — CRUD for every keel resource plus work-management
 * custom routes (archive, assign, complete, QUERY search, …).
 */
export const KEEL_SURFACE_FLOWS: Record<string, Flow> = {
  ...crud({
    unit: "tasks",
    table: "sql:tasks",
    collection: "/tasks",
    item: "/tasks/:id",
    readGates: MEMBER,
    writeGates: TASK_WRITE,
    skip: ["list", "create", "update"],
    sourceDir: "src/flows/tasks",
  }),
  "tasks.archive": httpFlow({
    method: "POST",
    path: "/tasks/:id/archive",
    gates: TASK_WRITE,
    out: OK,
    errors: ["NotFound"],
    effects: { reads: ["sql:tasks"], writes: ["sql:tasks"] },
    source: "src/flows/tasks/index.ts:295",
  }),
  "tasks.assign": httpFlow({
    method: "POST",
    path: "/tasks/:id/assign",
    gates: TASK_WRITE,
    in: ASSIGN_IN,
    out: ID,
    errors: ["NotFound"],
    effects: {
      reads: ["sql:tasks", "sql:members"],
      writes: ["sql:task_assignees"],
      emits: ["task-assigned"],
      sends: ["task-assigned"],
    },
    source: "src/flows/tasks/index.ts:221",
  }),
  "tasks.complete": httpFlow({
    method: "POST",
    path: "/tasks/:id/complete",
    gates: TASK_WRITE,
    out: OK,
    errors: ["NotFound"],
    effects: { reads: ["sql:tasks"], writes: ["sql:tasks"], emits: ["task-completed"] },
    source: "src/flows/tasks/index.ts:267",
  }),
  "tasks.follow": httpFlow({
    method: "POST",
    path: "/tasks/:id/follow",
    gates: MEMBER,
    out: OK,
    effects: { reads: ["sql:tasks"], writes: ["sql:inbox"] },
    source: "src/flows/tasks/index.ts:312",
  }),
  "tasks.duplicate": httpFlow({
    method: "POST",
    path: "/tasks/:id/duplicate",
    gates: TASK_WRITE,
    out: ID,
    errors: ["NotFound"],
    effects: {
      reads: ["sql:tasks"],
      writes: ["sql:tasks"],
      emits: ["task-created"],
      calls: ["tasks.create"],
    },
    source: "src/flows/tasks/index.ts:353",
  }),
  "tasks.move": httpFlow({
    method: "POST",
    path: "/tasks/:id/move",
    gates: TASK_WRITE,
    in: MOVE_IN,
    out: ID,
    errors: ["NotFound", "Forbidden"],
    effects: { reads: ["sql:tasks", "sql:spaces"], writes: ["sql:tasks"] },
    source: "src/flows/tasks/index.ts:377",
  }),
  "tasks.depend": httpFlow({
    method: "POST",
    path: "/tasks/:id/depend",
    gates: TASK_WRITE,
    in: DEPEND_IN,
    out: OK,
    errors: ["NotFound"],
    effects: { reads: ["sql:tasks"], writes: ["sql:tasks"] },
    source: "src/flows/tasks/index.ts:403",
  }),
  "tasks.addTag": httpFlow({
    method: "POST",
    path: "/tasks/:id/tags",
    gates: TASK_WRITE,
    in: TAG_IN,
    out: OK,
    errors: ["NotFound"],
    effects: { reads: ["sql:tasks", "sql:tags"], writes: ["sql:tasks"] },
    source: "src/flows/tasks/index.ts:425",
  }),

  ...crud({
    unit: "comments",
    table: "sql:comments",
    collection: "/tasks/:id/comments",
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
    effects: { reads: ["sql:comments"], writes: ["sql:comments"] },
    source: "src/flows/comments/index.ts:130",
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
    effects: { reads: ["sql:projects"], writes: ["sql:projects"] },
    source: "src/flows/projects/index.ts:64",
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
      sends: ["goal-at-risk"],
    },
    source: "src/flows/projects/index.ts:88",
  }),
  "projects.listUpdates": httpFlow({
    method: "GET",
    path: "/projects/:id/updates",
    gates: MEMBER,
    in: KEEL_LIST_IN,
    out: KEEL_LIST_OUT,
    effects: { reads: ["sql:project_updates"] },
    source: "src/flows/projects/index.ts:117",
  }),
  "projects.listSections": httpFlow({
    method: "GET",
    path: "/projects/:id/sections",
    gates: MEMBER,
    in: KEEL_LIST_IN,
    out: KEEL_LIST_OUT,
    effects: { reads: ["sql:sections"] },
    source: "src/flows/projects/index.ts:137",
  }),
  "projects.addSection": httpFlow({
    method: "POST",
    path: "/projects/:id/sections",
    gates: PROJECT_ADMIN,
    in: TITLE_IN,
    out: ID,
    effects: { reads: ["sql:projects"], writes: ["sql:sections"] },
    source: "src/flows/projects/index.ts:158",
  }),

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
    source: "src/flows/documents/index.ts:4",
  }),
  "documents.summarize": httpFlow({
    method: "POST",
    path: "/documents/:id/summarize",
    gates: MEMBER,
    out: { type: "object", required: ["summary"], properties: { summary: { type: "string" } } },
    effects: { reads: ["sql:documents"], secrets: ["OPENAI_KEY"], asks: ["document-summary"] },
    source: "src/flows/documents/index.ts:61",
  }),

  ...crud({
    unit: "attachments",
    table: "sql:file_objects",
    collection: "/tasks/:id/attachments",
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
    source: "src/flows/attachments/index.ts:82",
  }),

  ...crud({
    unit: "spaces",
    table: "sql:spaces",
    collection: "/spaces",
    item: "/spaces/:id",
    readGates: MEMBER,
    writeGates: PROJECT_ADMIN,
    liveList: true,
    createIn: {
      type: "object",
      required: ["key", "name"],
      properties: { key: { type: "string" }, name: { type: "string" } },
    },
    sourceDir: "src/flows/spaces",
  }),

  ...crud({
    unit: "tags",
    table: "sql:tags",
    collection: "/tags",
    item: "/tags/:id",
    readGates: MEMBER,
    writeGates: PROJECT_ADMIN,
    createIn: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" }, groupName: { type: "string" } },
    },
    sourceDir: "src/flows/tags",
  }),

  ...crud({
    unit: "goals",
    table: "sql:goals",
    collection: "/goals",
    item: "/goals/:id",
    readGates: MEMBER,
    writeGates: PROJECT_ADMIN,
    createIn: TITLE_IN,
    sourceDir: "src/flows/goals",
  }),
  "goals.rollup": {
    trigger: { cron: "0 9 * * 1" },
    plane: "operator",
    effects: {
      reads: ["sql:goals", "sql:tasks"],
      writes: ["sql:goals"],
      emits: ["goal-at-risk"],
      asks: ["weekly-summary"],
      sends: ["goal-at-risk"],
      secrets: ["SLACK_WEBHOOK"],
    },
    source: "src/flows/goals/index.ts:33",
  },

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
        spaceId: { type: "string" },
      },
    },
    out: ID,
    effects: { reads: ["sql:spaces"], writes: ["sql:members"] },
    source: "src/flows/members/index.ts:36",
  }),

  ...crud({
    unit: "views",
    table: "sql:views",
    collection: "/views",
    item: "/views/:id",
    readGates: MEMBER,
    writeGates: PROJECT_ADMIN,
    createIn: TITLE_IN,
    sourceDir: "src/flows/views",
  }),

  ...crud({
    unit: "forms",
    table: "sql:forms",
    collection: "/forms",
    item: "/forms/:id",
    readGates: MEMBER,
    writeGates: PROJECT_ADMIN,
    skip: ["create"],
    sourceDir: "src/flows/forms",
  }),
  "forms.create": httpFlow({
    method: "POST",
    path: "/forms",
    gates: PROJECT_ADMIN,
    in: {
      type: "object",
      required: ["projectId", "name"],
      properties: { projectId: { type: "string" }, name: { type: "string" } },
    },
    out: ID,
    effects: { reads: ["sql:projects"], writes: ["sql:forms"] },
    source: "src/flows/forms/index.ts:33",
  }),

  ...crud({
    unit: "inbox",
    table: "sql:inbox",
    collection: "/inbox",
    item: "/inbox/:id",
    readGates: MEMBER,
    writeGates: MEMBER,
    skip: ["create"],
    liveList: true,
    sourceDir: "src/flows/inbox",
  }),

  "my.tasks": httpFlow({
    method: "GET",
    path: "/me/tasks",
    gates: MEMBER,
    live: true,
    in: KEEL_LIST_IN,
    out: KEEL_LIST_OUT,
    effects: { reads: ["sql:tasks", "sql:task_assignees"] },
    source: "src/flows/my/index.ts:9",
  }),
  "my.plan": httpFlow({
    method: "POST",
    path: "/me/plan",
    gates: MEMBER,
    out: {
      type: "object",
      required: ["summary"],
      properties: { summary: { type: "string" }, replyQueued: { type: "boolean" } },
    },
    effects: {
      reads: ["sql:inbox"],
      secrets: ["OPENAI_KEY"],
      asks: ["form-classify"],
      sends: ["mention-reply"],
    },
    source: "src/flows/my/index.ts:51",
  }),

  "search.query": httpFlow({
    method: "QUERY",
    path: "/search",
    gates: MEMBER,
    in: SEARCH_IN,
    out: KEEL_LIST_OUT,
    effects: { reads: ["index:tasks", "sql:tasks"], secrets: ["PUBLIC_DOCS_URL"] },
    source: "src/flows/search/index.ts:46",
  }),
  "search.suggest": httpFlow({
    method: "GET",
    path: "/search/suggest",
    gates: MEMBER,
    cache: "15s",
    in: KEEL_LIST_IN,
    out: KEEL_LIST_OUT,
    effects: { reads: ["index:tasks"] },
    source: "src/flows/search/index.ts:92",
  }),
  "search.reindex": httpFlow({
    method: "POST",
    path: "/search/reindex",
    plane: "operator",
    gates: MEMBER,
    durable: true,
    out: OK,
    effects: { reads: ["sql:tasks"], writes: ["index:tasks"] },
    source: "src/flows/search/index.ts:109",
  }),
  "search.onComment": {
    trigger: { signal: "comment-added" },
    plane: "operator",
    effects: { reads: ["sql:comments"], writes: ["index:tasks"] },
    source: "src/flows/search/index.ts:152",
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
    source: "src/flows/github/index.ts:37",
  }),
  "github.disconnect": httpFlow({
    method: "DELETE",
    path: "/integrations/github",
    gates: PROJECT_ADMIN,
    out: OK,
    effects: { secrets: ["GITHUB_TOKEN"] },
    source: "src/flows/github/index.ts:50",
  }),
  "github.sync": httpFlow({
    method: "POST",
    path: "/integrations/github/sync",
    gates: MEMBER,
    durable: true,
    out: OK,
    effects: { secrets: ["GITHUB_TOKEN"], calls: ["tasks.create"] },
    source: "src/flows/github/index.ts:16",
  }),

  "drafts.list": httpFlow({
    method: "GET",
    path: "/drafts",
    gates: MEMBER,
    in: KEEL_LIST_IN,
    out: KEEL_LIST_OUT,
    effects: { reads: ["kv:drafts"] },
    source: "src/flows/drafts/index.ts:18",
  }),
  "drafts.save": httpFlow({
    method: "PUT",
    path: "/drafts/:id",
    gates: MEMBER,
    in: DRAFT_IN,
    out: ID,
    effects: { writes: ["kv:drafts"] },
    source: "src/flows/drafts/index.ts:36",
  }),
  "drafts.discard": httpFlow({
    method: "DELETE",
    path: "/drafts/:id",
    gates: MEMBER,
    out: OK,
    effects: { writes: ["kv:drafts"] },
    source: "src/flows/drafts/index.ts:49",
  }),

  "webhooks.list": httpFlow({
    method: "GET",
    path: "/webhooks",
    gates: WEBHOOK_ADMIN,
    in: KEEL_LIST_IN,
    out: KEEL_LIST_OUT,
    effects: { secrets: ["WEBHOOK_SECRET"] },
    source: "src/flows/webhooks/index.ts:14",
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
    source: "src/flows/webhooks/index.ts:33",
  }),
  "webhooks.delete": httpFlow({
    method: "DELETE",
    path: "/webhooks/:id",
    gates: WEBHOOK_ADMIN,
    out: OK,
    effects: { secrets: ["WEBHOOK_SECRET"] },
    source: "src/flows/webhooks/index.ts:48",
  }),
  "webhooks.rotate": httpFlow({
    method: "POST",
    path: "/webhooks/:id/rotate",
    gates: WEBHOOK_ADMIN,
    out: OK,
    effects: { secrets: ["WEBHOOK_SECRET"] },
    source: "src/flows/webhooks/index.ts:62",
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
    effects: { secrets: ["SLACK_BOT"], calls: ["tasks.create"] },
    source: "src/flows/slack/index.ts:8",
  }),

  "main.health": httpFlow({
    method: "HEAD",
    path: "/health",
    plane: "operator",
    gates: MEMBER,
    out: OK,
    effects: { secrets: ["PUBLIC_API_URL"] },
    source: "src/flows/main/index.ts:24",
  }),

  "notify.onForm": {
    trigger: { signal: "form-submitted" },
    plane: "user",
    effects: { reads: ["sql:form_submissions"], sends: ["form-received"] },
    source: "src/flows/notify/index.ts:80",
  },
  "notify.onGoal": {
    trigger: { signal: "goal-at-risk" },
    plane: "user",
    effects: { reads: ["sql:goals"], sends: ["goal-at-risk"] },
    source: "src/flows/notify/index.ts:104",
  },

  "digest.daily": {
    trigger: { cron: "0 8 * * *" },
    plane: "operator",
    effects: {
      reads: ["sql:tasks", "sql:goals"],
      asks: ["weekly-summary"],
      sends: ["daily-digest"],
      secrets: ["SLACK_WEBHOOK"],
    },
    source: "src/flows/digest/index.ts:7",
  },
  "recurring.spawn": {
    trigger: { every: "1h" },
    plane: "operator",
    effects: { reads: ["sql:tasks"], writes: ["sql:tasks"], calls: ["tasks.create"] },
    source: "src/flows/recurring/index.ts:9",
  },
};

/**
 * Extra signals for the expanded keel surface.
 */
export const KEEL_SURFACE_SIGNALS: NonNullable<Manifest["signals"]> = {};

/**
 * Extra clocks — featured clocks live in the base manifest.
 */
export const KEEL_SURFACE_CLOCKS: NonNullable<Manifest["clocks"]> = {};

/**
 * Extra gates for the expanded write surface.
 */
export const KEEL_SURFACE_GATES: NonNullable<Manifest["gates"]> = {
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
};

/**
 * Extra vault contracts used by webhooks / Slack ingest.
 */
export const KEEL_SURFACE_VAULT: NonNullable<Manifest["vault"]> = {
  WEBHOOK_SECRET: { description: "Outbound webhook HMAC signing key", rotate: "never" },
  SLACK_BOT: { description: "Slack form-intake bot token", rotate: "90d" },
};

/**
 * Extra channel templates — featured templates live in the base manifest.
 */
export const KEEL_SURFACE_CHANNELS: NonNullable<Manifest["channels"]> = {
  "task-followed": {
    medium: "email" satisfies ChannelMedium,
    locales: ["en"],
    description: "New follower confirmation",
  },
};
