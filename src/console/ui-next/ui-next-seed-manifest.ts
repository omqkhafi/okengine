/**
 * Standalone keel Manifest for Console ui-next seed.
 *
 * Asana / ClickUp / Monday-shaped work-management backend — all eight OKE
 * elements, all five trigger kinds. Not an overlay of the skyport flows fixture.
 */

import type { Manifest } from "../../manifest/types.ts";
import { UI_NEXT_SEED_APP_SYSTEM_TABLES } from "./ui-next-seed-app-schema.ts";
import {
  KEEL_LIST_IN,
  KEEL_LIST_OUT,
  KEEL_SURFACE_CHANNELS,
  KEEL_SURFACE_CLOCKS,
  KEEL_SURFACE_FLOWS,
  KEEL_SURFACE_GATES,
  KEEL_SURFACE_SIGNALS,
  KEEL_SURFACE_VAULT,
} from "./ui-next-seed-manifest-surface.ts";

/**
 * Manifest seeded into the Console — a work-management workspace so the
 * Flows graph + Traces ledger + Store browse look like a real PM system.
 *
 * | Element | Seed surface |
 * | ------- | ------------ |
 * | flow    | featured github→create→notify plus full CRUD + custom routes (archive, assign, QUERY search, …) |
 * | signal  | `task-created` · `task-completed` · `task-assigned` · `comment-added` · `form-submitted` · `goal-at-risk` · `draft-expired` |
 * | store   | sql spaces…form_submissions + Gate auth / oke_* system · kv drafts/reminders · files keel · index tasks/documents/comments/projects |
 * | clock   | `expire-drafts` every · `watch-overdue` every · `daily-digest` cron |
 * | gate    | member · task:write · project:admin · comment:write |
 * | vault   | keel secrets + public config (origin, API, docs, workspace) |
 * | channel | task-assigned · mention-reply · task-overdue · daily-digest · form-received · goal-at-risk |
 * | ai      | task-suggest · weekly-summary · form-classify · document-summary · planner agent |
 */
export const UI_NEXT_SEEDED_MANIFEST: Manifest = {
  oke: "1.0",
  app: "keel",
  i18n: {
    locales: ["en", "ar"],
    default: "en",
    dir: { ar: "rtl" },
  },
  flows: {
    "github.ingest": {
      trigger: { http: { method: "POST", path: "/integrations/github" } },
      plane: "user",
      durable: true,
      gates: ["member"],
      effects: {
        secrets: ["GITHUB_TOKEN"],
        calls: ["tasks.create"],
      },
      source: "src/flows/github/index.ts:16",
    },
    "tasks.create": {
      trigger: { http: { method: "POST", path: "/tasks" } },
      plane: "user",
      gates: ["member", "task:write"],
      in: {
        type: "object",
        required: ["title", "spaceKey"],
        properties: {
          title: { type: "string" },
          spaceKey: {
            type: "string",
            oneOf: [
              { const: "ENG", title: "Engineering" },
              { const: "DES", title: "Design" },
              { const: "GTM", title: "Go-to-market" },
            ],
          },
          priority: {
            type: "integer",
            minimum: 0,
            maximum: 4,
            description: "Must be from 0 up to 4.",
            oneOf: [
              { const: 0, title: "No priority" },
              { const: 1, title: "Urgent" },
              { const: 2, title: "High" },
              { const: 3, title: "Medium" },
              { const: 4, title: "Low" },
            ],
          },
        },
      },
      out: {
        type: "object",
        required: ["id", "identifier"],
        properties: {
          id: { type: "string" },
          identifier: { type: "string" },
          userId: { type: "string" },
        },
      },
      errors: ["Forbidden", "Duplicate"],
      effects: {
        reads: ["sql:tasks", "sql:spaces"],
        writes: ["sql:tasks"],
        emits: ["task-created"],
      },
      source: "src/flows/tasks/index.ts:90",
    },
    "tasks.update": {
      trigger: { http: { method: "PATCH", path: "/tasks/:id" } },
      plane: "user",
      gates: ["member", "task:write"],
      effects: {
        reads: ["sql:tasks"],
        writes: ["sql:tasks"],
      },
      source: "src/flows/tasks/index.ts:147",
    },
    "tasks.list": {
      trigger: { http: { method: "GET", path: "/tasks" } },
      live: true,
      plane: "user",
      gates: ["member"],
      in: KEEL_LIST_IN,
      out: KEEL_LIST_OUT,
      effects: { reads: ["sql:tasks"], secrets: ["PUBLIC_APP_URL", "KEEL_WORKSPACE"] },
      source: "src/flows/tasks/index.ts:174",
    },
    "comments.create": {
      trigger: { http: { method: "POST", path: "/tasks/:id/comments" } },
      plane: "user",
      gates: ["member", "comment:write"],
      effects: {
        reads: ["sql:tasks"],
        writes: ["sql:comments"],
        emits: ["comment-added"],
      },
      source: "src/flows/comments/index.ts:48",
    },
    "projects.create": {
      trigger: { http: { method: "POST", path: "/projects" } },
      plane: "user",
      gates: ["member", "project:admin"],
      effects: {
        reads: ["sql:goals"],
        writes: ["sql:projects"],
      },
      source: "src/flows/projects/index.ts:40",
    },
    "documents.upsert": {
      trigger: { http: { method: "POST", path: "/documents" } },
      plane: "user",
      gates: ["member"],
      effects: {
        writes: ["sql:documents"],
      },
      source: "src/flows/documents/index.ts:37",
    },
    "attachments.upload": {
      trigger: { http: { method: "POST", path: "/attachments" } },
      plane: "user",
      gates: ["member", "task:write"],
      effects: {
        reads: ["sql:tasks"],
        writes: ["files:keel"],
      },
      source: "src/flows/attachments/index.ts:22",
    },
    "forms.submit": {
      trigger: { http: { method: "POST", path: "/forms/:id/submit" } },
      plane: "user",
      durable: true,
      gates: ["member"],
      effects: {
        reads: ["sql:forms", "sql:spaces"],
        writes: ["sql:form_submissions", "sql:tasks"],
        emits: ["form-submitted"],
        asks: ["form-classify"],
        secrets: ["OPENAI_KEY"],
        calls: ["tasks.create"],
      },
      source: "src/flows/forms/index.ts:59",
    },
    "notify.onTask": {
      trigger: { signal: "task-created" },
      plane: "user",
      effects: {
        writes: ["sql:inbox"],
        sends: ["task-assigned"],
      },
      source: "src/flows/notify/index.ts:42",
    },
    "notify.onComment": {
      trigger: { signal: "comment-added" },
      plane: "user",
      effects: {
        reads: ["sql:comments"],
        sends: ["mention-reply"],
      },
      source: "src/flows/notify/index.ts:63",
    },
    "search.index": {
      trigger: { signal: "task-created" },
      plane: "operator",
      effects: {
        reads: ["sql:tasks"],
        writes: ["index:tasks"],
      },
      source: "src/flows/search/index.ts:140",
    },
    "tasks.onStatus": {
      trigger: { cdc: { table: "tasks", column: "status" } },
      plane: "operator",
      effects: {
        reads: ["sql:tasks"],
        writes: ["sql:tasks"],
      },
      source: "src/flows/tasks/index.ts:461",
    },
    "drafts.expire": {
      trigger: { every: "10m" },
      plane: "operator",
      effects: {
        reads: ["kv:drafts"],
        writes: ["kv:drafts"],
        emits: ["draft-expired"],
      },
      source: "src/flows/drafts/index.ts:62",
    },
    "overdue.watch": {
      trigger: { every: "15m" },
      plane: "operator",
      effects: {
        reads: ["sql:tasks"],
        emits: ["task-created"],
        sends: ["task-overdue"],
      },
      source: "src/flows/overdue/index.ts:7",
    },
    ...KEEL_SURFACE_FLOWS,
  },
  signals: {
    "task-created": {
      delivery: "once",
      retries: 5,
      deadLetter: true,
      description: "Task created — wake notify + search",
    },
    "task-completed": {
      delivery: "broadcast",
      retries: 3,
      deadLetter: true,
      description: "Task marked complete — rollover dependents",
    },
    "task-assigned": {
      delivery: "live",
      retries: 3,
      deadLetter: true,
      description: "Assignee changed — realtime inbox",
    },
    "comment-added": {
      delivery: "once",
      retries: 3,
      deadLetter: true,
      description: "Comment posted — mention reply",
    },
    "form-submitted": {
      delivery: "once",
      retries: 3,
      deadLetter: true,
      description: "Customer form intake received",
    },
    "goal-at-risk": {
      delivery: "once",
      retries: 3,
      deadLetter: true,
      description: "Goal health slipped to at-risk",
    },
    "draft-expired": {
      delivery: "once",
      retries: 3,
      deadLetter: true,
      description: "Compose-draft TTL elapsed",
    },
    ...KEEL_SURFACE_SIGNALS,
  },
  stores: {
    db: {
      facet: "sql",
      description: "Primary keel SQL",
      tables: {
        spaces: {
          columns: {
            id: { type: "text", primaryKey: true },
            key: { type: "text" },
            name: { type: "text" },
            color: { type: "text", nullable: true },
          },
        },
        members: {
          columns: {
            id: { type: "text", primaryKey: true },
            space_id: { type: "text" },
            name: { type: "text" },
            email: { type: "text", pii: true, description: "Member contact (masked by default)" },
            role: { type: "text" },
          },
        },
        goals: {
          columns: {
            id: { type: "text", primaryKey: true },
            name: { type: "text" },
            status: { type: "text" },
            owner_email: { type: "text", pii: true },
            target_date: { type: "text" },
          },
        },
        projects: {
          columns: {
            id: { type: "text", primaryKey: true },
            space_id: { type: "text" },
            goal_id: { type: "text", nullable: true },
            name: { type: "text" },
            status: { type: "text" },
            lead_email: { type: "text", pii: true },
            start_date: { type: "text", nullable: true },
            target_date: { type: "text" },
            color: { type: "text", nullable: true },
          },
        },
        sections: {
          columns: {
            id: { type: "text", primaryKey: true },
            project_id: { type: "text" },
            name: { type: "text" },
            sort_order: { type: "integer" },
          },
        },
        tasks: {
          columns: {
            id: { type: "text", primaryKey: true },
            identifier: { type: "text" },
            title: { type: "text" },
            description: { type: "text", description: "Task body (mixed RTL/LTR sample)" },
            kind: { type: "text" },
            priority: { type: "integer" },
            estimate: { type: "integer", nullable: true },
            status: { type: "text" },
            space_id: { type: "text" },
            project_id: { type: "text", nullable: true },
            section_id: { type: "text", nullable: true },
            parent_id: { type: "text", nullable: true },
            due_date: { type: "text", nullable: true },
            completed_at: { type: "text", nullable: true },
            archived_at: { type: "text", nullable: true },
            creator_email: { type: "text", pii: true },
            role_needed: { type: "text", nullable: true },
          },
        },
        task_assignees: {
          columns: {
            id: { type: "text", primaryKey: true },
            task_id: { type: "text" },
            assignee_email: { type: "text", pii: true },
          },
        },
        comments: {
          columns: {
            id: { type: "text", primaryKey: true },
            task_id: { type: "text" },
            author_email: { type: "text", pii: true },
            body: { type: "text", description: "Comment body (mixed RTL/LTR sample)" },
          },
        },
        forms: {
          columns: {
            id: { type: "text", primaryKey: true },
            project_id: { type: "text" },
            name: { type: "text" },
            schema_json: { type: "text" },
          },
        },
        form_submissions: {
          columns: {
            id: { type: "text", primaryKey: true },
            form_id: { type: "text" },
            task_id: { type: "text", nullable: true },
            payload_json: { type: "text" },
            customer_name: { type: "text" },
          },
        },
        inbox: {
          columns: {
            id: { type: "text", primaryKey: true },
            member_email: { type: "text", pii: true },
            kind: { type: "text" },
            title: { type: "text" },
            ref_id: { type: "text" },
            read_at: { type: "text", nullable: true },
          },
        },
        views: {
          columns: {
            id: { type: "text", primaryKey: true },
            project_id: { type: "text" },
            name: { type: "text" },
            kind: { type: "text" },
            filters_json: { type: "text" },
            owner_email: { type: "text", pii: true },
          },
        },
        tags: {
          columns: {
            id: { type: "text", primaryKey: true },
            name: { type: "text" },
            group_name: { type: "text", nullable: true },
          },
        },
        documents: {
          columns: {
            id: { type: "text", primaryKey: true },
            title: { type: "text" },
            body: { type: "text" },
            parent_kind: { type: "text" },
            parent_id: { type: "text" },
          },
        },
        file_objects: {
          columns: {
            id: { type: "text", primaryKey: true },
            object_key: { type: "text" },
            original_name: { type: "text" },
            content_type: { type: "text" },
            size_bytes: { type: "integer" },
            store_ref: { type: "text" },
          },
        },
        project_updates: {
          columns: {
            id: { type: "text", primaryKey: true },
            project_id: { type: "text" },
            health: { type: "text" },
            body: { type: "text" },
            author_email: { type: "text", pii: true },
          },
        },
        ...UI_NEXT_SEED_APP_SYSTEM_TABLES,
      },
    },
    cache: {
      facet: "kv",
      description: "Compose drafts + view prefs + due-date reminders",
      namespaces: ["drafts", "view-prefs", "reminders"],
    },
    keel: {
      facet: "files",
      description: "Keel workspace files",
      buckets: ["keel"],
    },
    search: {
      facet: "index",
      description: "Task search",
      indexes: ["tasks"],
    },
    documents: {
      facet: "index",
      description: "Document search",
      indexes: ["documents"],
    },
    comments: {
      facet: "index",
      description: "Comment search",
      indexes: ["comments"],
    },
    projects: {
      facet: "index",
      description: "Project search",
      indexes: ["projects"],
    },
  },
  clocks: {
    "expire-drafts": {
      every: "10m",
      timezone: "UTC",
      overridable: true,
      description: "Expire stale compose drafts",
    },
    "watch-overdue": {
      every: "15m",
      timezone: "UTC",
      description: "Scan overdue tasks",
    },
    "daily-digest": {
      cron: "0 8 * * *",
      timezone: "UTC",
      description: "Morning inbox + goal digest",
    },
    "spawn-recurring": {
      every: "1h",
      timezone: "UTC",
      description: "Spawn recurring task occurrences",
    },
    "rollup-goals": {
      cron: "0 9 * * 1",
      timezone: "UTC",
      description: "Weekly goal rollup",
    },
    ...KEEL_SURFACE_CLOCKS,
  },
  gates: {
    member: {
      kind: "policy",
      description: "Signed-in workspace member",
    },
    "task:write": {
      kind: "policy",
      description: "May create and update tasks",
      scopes: ["task:write"],
    },
    "project:admin": {
      kind: "policy",
      description: "May create projects, views, and forms",
      scopes: ["project:admin"],
    },
    "comment:write": {
      kind: "policy",
      description: "May edit and resolve comments",
      scopes: ["comment:write"],
    },
    ...KEEL_SURFACE_GATES,
  },
  vault: {
    GITHUB_TOKEN: { description: "GitHub PR intake token", rotate: "90d" },
    OPENAI_KEY: { description: "Task planner model key", rotate: "90d" },
    SLACK_WEBHOOK: { description: "Goal digest incoming webhook", rotate: "90d" },
    PUBLIC_APP_URL: {
      description: "Public Keel origin",
      sensitive: false,
    },
    PUBLIC_API_URL: {
      description: "Public API origin",
      sensitive: false,
    },
    PUBLIC_DOCS_URL: {
      description: "Public docs origin",
      sensitive: false,
    },
    KEEL_WORKSPACE: {
      description: "Workspace slug",
      sensitive: false,
    },
    ...KEEL_SURFACE_VAULT,
  },
  channels: {
    "task-assigned": {
      medium: "email",
      locales: ["en"],
      description: "Assignee notification",
    },
    "mention-reply": {
      medium: "email",
      locales: ["en", "ar"],
      description: "Comment mention reply",
    },
    "task-overdue": {
      medium: "email",
      locales: ["en"],
      description: "Overdue task",
    },
    "daily-digest": {
      medium: "email",
      locales: ["en", "ar"],
      description: "Morning inbox + goal digest",
    },
    "form-received": {
      medium: "email",
      locales: ["en"],
      description: "Form intake received",
    },
    "goal-at-risk": {
      medium: "email",
      locales: ["en"],
      description: "Goal health at risk",
    },
    ...KEEL_SURFACE_CHANNELS,
  },
  ai: {
    models: {
      smart: { provider: "openai", tier: "smart", model: "gpt-4.1" },
      fast: { provider: "openai", tier: "fast", model: "gpt-4.1-mini" },
    },
    prompts: {
      "task-suggest": {
        version: 1,
        model: "smart",
        via: ["smart", "fast"],
        timeout: "30s",
        budget: { maxCostPerCall: 0.02 },
      },
      "weekly-summary": {
        version: 1,
        model: "fast",
        via: ["fast"],
        timeout: "15s",
        budget: { maxCostPerCall: 0.005 },
      },
      "form-classify": {
        version: 1,
        model: "fast",
        via: ["fast"],
        timeout: "20s",
        budget: { maxCostPerCall: 0.008 },
      },
      "document-summary": {
        version: 1,
        model: "fast",
        via: ["fast"],
        timeout: "20s",
        budget: { maxCostPerCall: 0.008 },
      },
    },
    agents: {
      planner: {
        tools: [
          "tasks.list",
          "tasks.get",
          "tasks.create",
          "tasks.assign",
          "comments.create",
          "inbox.list",
          "search.query",
        ],
        maxSteps: 8,
        model: "smart",
        budget: { maxCostPerRun: 0.25 },
      },
    },
  },
};
