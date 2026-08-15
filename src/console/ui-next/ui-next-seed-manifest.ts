/**
 * Standalone keel Manifest for Console ui-next seed.
 *
 * Linear-faithful project-management backend — all eight OKE elements,
 * all five trigger kinds. Not an overlay of the skyport flows fixture.
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
 * Manifest seeded into the Console — a Linear-shaped workspace so the
 * Flows graph + Traces ledger + Store browse look like a real PM system.
 *
 * | Element | Seed surface |
 * | ------- | ------------ |
 * | flow    | featured github→create→notify plus full CRUD + custom routes (archive, assign, merge, QUERY search, …) |
 * | signal  | `issue-created` · `comment-added` · `cycle-closed` · `sla-breaching` · `draft-expired` |
 * | store   | sql teams…customer_requests + Gate auth / oke_* system · kv drafts/snooze · files attachments · index issues |
 * | clock   | `close-cycles` cron · `expire-drafts` every · `watch-sla` every |
 * | gate    | member · issue:write · project:admin · triage:accept · issues.write |
 * | vault   | keel secrets + public config (origin, API, docs, workspace) |
 * | channel | issue-assigned · mention-reply · cycle-digest · sla-alert · project-update |
 * | ai      | issue-triage@3 · cycle-summary@1 · triage agent |
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
        calls: ["issues.create"],
      },
      source: "src/flows/github/index.ts:8",
    },
    "issues.create": {
      trigger: { http: { method: "POST", path: "/issues" } },
      plane: "user",
      gates: ["member", "issue:write", "issues.write"],
      in: {
        type: "object",
        required: ["title", "teamKey"],
        properties: {
          title: { type: "string" },
          teamKey: { type: "string" },
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
      errors: ["CycleClosed", "Duplicate"],
      effects: {
        reads: ["sql:issues", "sql:cycles"],
        writes: ["sql:issues"],
        emits: ["issue-created"],
      },
      source: "src/flows/issues/index.ts:18",
    },
    "issues.update": {
      trigger: { http: { method: "PATCH", path: "/issues/:id" } },
      plane: "user",
      gates: ["member", "issue:write", "issues.write"],
      effects: {
        reads: ["sql:issues"],
        writes: ["sql:issues"],
      },
      source: "src/flows/issues/index.ts:64",
    },
    "issues.list": {
      trigger: { http: { method: "GET", path: "/issues" } },
      live: true,
      plane: "user",
      gates: ["member"],
      in: KEEL_LIST_IN,
      out: KEEL_LIST_OUT,
      effects: { reads: ["sql:issues"], secrets: ["PUBLIC_APP_URL", "KEEL_WORKSPACE"] },
      source: "src/flows/issues/index.ts:88",
    },
    "comments.create": {
      trigger: { http: { method: "POST", path: "/issues/:id/comments" } },
      plane: "user",
      gates: ["member", "issue:write"],
      effects: {
        reads: ["sql:issues"],
        writes: ["sql:comments"],
        emits: ["comment-added"],
      },
      source: "src/flows/comments/index.ts:6",
    },
    "projects.create": {
      trigger: { http: { method: "POST", path: "/projects" } },
      plane: "user",
      gates: ["member", "project:admin"],
      effects: {
        reads: ["sql:initiatives"],
        writes: ["sql:projects"],
      },
      source: "src/flows/projects/index.ts:10",
    },
    "documents.upsert": {
      trigger: { http: { method: "POST", path: "/documents" } },
      plane: "user",
      gates: ["member"],
      effects: {
        writes: ["sql:documents"],
      },
      source: "src/flows/documents/index.ts:4",
    },
    "attachments.upload": {
      trigger: { http: { method: "POST", path: "/attachments" } },
      plane: "user",
      gates: ["member", "issue:write"],
      effects: {
        reads: ["sql:issues"],
        writes: ["files:attachments"],
      },
      source: "src/flows/attachments/index.ts:7",
    },
    "triage.accept": {
      trigger: { http: { method: "POST", path: "/triage/:id/accept" } },
      plane: "user",
      gates: ["member", "triage:accept"],
      effects: {
        reads: ["sql:issues", "sql:workflow_states"],
        writes: ["sql:issues"],
      },
      source: "src/flows/triage/index.ts:12",
    },
    "triage.suggest": {
      trigger: { http: { method: "POST", path: "/triage/:id/suggest" } },
      plane: "user",
      gates: ["member"],
      effects: {
        reads: ["sql:issues"],
        secrets: ["OPENAI_KEY"],
        asks: ["issue-triage"],
        sends: ["mention-reply"],
      },
      source: "src/flows/triage/index.ts:36",
    },
    "notify.onIssue": {
      trigger: { signal: "issue-created" },
      plane: "user",
      effects: {
        writes: ["sql:issues"],
        sends: ["issue-assigned"],
      },
      source: "src/flows/notify/index.ts:4",
    },
    "notify.onComment": {
      trigger: { signal: "comment-added" },
      plane: "user",
      effects: {
        reads: ["sql:comments"],
        sends: ["mention-reply"],
      },
      source: "src/flows/notify/index.ts:22",
    },
    "search.index": {
      trigger: { signal: "issue-created" },
      plane: "operator",
      effects: {
        reads: ["sql:issues"],
        writes: ["index:issues"],
      },
      source: "src/flows/search/index.ts:4",
    },
    "issues.onStatus": {
      trigger: { cdc: { table: "issues", column: "state_id" } },
      plane: "operator",
      effects: {
        reads: ["sql:issues"],
        writes: ["sql:issues"],
      },
      source: "src/flows/issues/cdc.ts:3",
    },
    "cycles.close": {
      trigger: { cron: "0 3 * * 1" },
      plane: "operator",
      effects: {
        reads: ["sql:cycles", "sql:issues"],
        writes: ["sql:cycles", "sql:issues"],
        emits: ["cycle-closed"],
        asks: ["cycle-summary"],
        sends: ["cycle-digest"],
        secrets: ["SLACK_WEBHOOK"],
      },
      source: "src/flows/cycles/index.ts:8",
    },
    "drafts.expire": {
      trigger: { every: "10m" },
      plane: "operator",
      effects: {
        reads: ["kv:drafts"],
        writes: ["kv:drafts"],
        emits: ["draft-expired"],
      },
      source: "src/flows/drafts/index.ts:6",
    },
    "sla.watch": {
      trigger: { every: "15m" },
      plane: "operator",
      effects: {
        reads: ["sql:issues"],
        emits: ["sla-breaching"],
        sends: ["sla-alert"],
      },
      source: "src/flows/sla/index.ts:5",
    },
    ...KEEL_SURFACE_FLOWS,
  },
  signals: {
    "issue-created": {
      delivery: "once",
      retries: 5,
      deadLetter: true,
      description: "Issue created — wake notify + search",
    },
    "comment-added": {
      delivery: "live",
      retries: 3,
      deadLetter: true,
      description: "Comment posted — realtime inbox",
    },
    "cycle-closed": {
      delivery: "broadcast",
      retries: 3,
      deadLetter: true,
      description: "Cycle completed — rollover leftovers",
    },
    "sla-breaching": {
      delivery: "once",
      retries: 3,
      deadLetter: true,
      description: "Issue SLA high-risk or breached",
    },
    "draft-expired": {
      delivery: "broadcast",
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
        teams: {
          columns: {
            id: { type: "text", primaryKey: true },
            key: { type: "text" },
            name: { type: "text" },
            parent_id: { type: "text", nullable: true },
          },
        },
        members: {
          columns: {
            id: { type: "text", primaryKey: true },
            team_id: { type: "text" },
            name: { type: "text" },
            email: { type: "text", pii: true, description: "Member contact (masked by default)" },
            role: { type: "text" },
          },
        },
        workflow_states: {
          columns: {
            id: { type: "text", primaryKey: true },
            team_id: { type: "text" },
            name: { type: "text" },
            type: { type: "text" },
            position: { type: "integer" },
          },
        },
        labels: {
          columns: {
            id: { type: "text", primaryKey: true },
            team_id: { type: "text", nullable: true },
            name: { type: "text" },
            group_name: { type: "text", nullable: true },
          },
        },
        initiatives: {
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
            initiative_id: { type: "text" },
            name: { type: "text" },
            status: { type: "text" },
            lead_email: { type: "text", pii: true },
            target_date: { type: "text" },
            progress: { type: "integer" },
          },
        },
        project_milestones: {
          columns: {
            id: { type: "text", primaryKey: true },
            project_id: { type: "text" },
            name: { type: "text" },
            target_date: { type: "text" },
            sort_order: { type: "integer" },
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
        cycles: {
          columns: {
            id: { type: "text", primaryKey: true },
            team_id: { type: "text" },
            number: { type: "integer" },
            name: { type: "text" },
            starts_at: { type: "text" },
            ends_at: { type: "text" },
            state: { type: "text" },
          },
        },
        issues: {
          columns: {
            id: { type: "text", primaryKey: true },
            identifier: { type: "text" },
            title: { type: "text" },
            description: { type: "text", description: "Issue body (mixed RTL/LTR sample)" },
            priority: { type: "integer" },
            estimate: { type: "integer", nullable: true },
            state_id: { type: "text" },
            team_id: { type: "text" },
            project_id: { type: "text", nullable: true },
            milestone_id: { type: "text", nullable: true },
            cycle_id: { type: "text", nullable: true },
            parent_id: { type: "text", nullable: true },
            assignee_email: { type: "text", pii: true },
            creator_email: { type: "text", pii: true },
            due_date: { type: "text", nullable: true },
            sla_breaches_at: { type: "text", nullable: true },
            triaged_at: { type: "text", nullable: true },
            archived_at: { type: "text", nullable: true },
          },
        },
        issue_labels: {
          columns: {
            id: { type: "text", primaryKey: true },
            issue_id: { type: "text" },
            label_id: { type: "text" },
          },
        },
        comments: {
          columns: {
            id: { type: "text", primaryKey: true },
            issue_id: { type: "text" },
            author_email: { type: "text", pii: true },
            body: { type: "text", description: "Comment body (mixed RTL/LTR sample)" },
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
        customer_requests: {
          columns: {
            id: { type: "text", primaryKey: true },
            issue_id: { type: "text" },
            customer_name: { type: "text" },
            body: { type: "text" },
          },
        },
        ...UI_NEXT_SEED_APP_SYSTEM_TABLES,
      },
    },
    cache: {
      facet: "kv",
      description: "Compose drafts + triage snooze",
      namespaces: ["drafts", "triage-snooze"],
    },
    attachments: {
      facet: "files",
      description: "Issue attachments (specs, screenshots)",
      buckets: ["attachments"],
    },
    search: {
      facet: "index",
      description: "Semantic issue search",
      indexes: ["issues"],
    },
  },
  clocks: {
    "close-cycles": {
      cron: "0 3 * * 1",
      timezone: "UTC",
      description: "Monday cycle rollover",
    },
    "expire-drafts": {
      every: "10m",
      timezone: "UTC",
      overridable: true,
      description: "Expire stale compose drafts",
    },
    "watch-sla": {
      every: "15m",
      timezone: "UTC",
      description: "Scan issue SLA high-risk / breached",
    },
    ...KEEL_SURFACE_CLOCKS,
  },
  gates: {
    member: {
      kind: "policy",
      description: "Signed-in workspace member",
    },
    "issue:write": {
      kind: "policy",
      description: "May create and update issues",
      scopes: ["issue:write"],
    },
    "project:admin": {
      kind: "policy",
      description: "May create projects",
      scopes: ["project:admin"],
    },
    "triage:accept": {
      kind: "policy",
      description: "May accept issues out of triage",
      scopes: ["triage:accept"],
    },
    "issues.write": {
      kind: "rate",
      strategy: "sliding-window-counter",
      max: 60,
      per: "1m",
      keyBy: "user",
      description: "Issue write throttle",
    },
    ...KEEL_SURFACE_GATES,
  },
  vault: {
    GITHUB_TOKEN: { description: "GitHub Issues sync token", rotate: "90d" },
    OPENAI_KEY: { description: "Issue triage model key", rotate: "90d" },
    SLACK_WEBHOOK: { description: "Cycle digest incoming webhook", rotate: "90d" },
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
    "issue-assigned": {
      medium: "email",
      locales: ["en"],
      description: "Assignee notification",
    },
    "mention-reply": {
      medium: "email",
      locales: ["en", "ar"],
      description: "Comment mention reply",
    },
    "cycle-digest": {
      medium: "email",
      locales: ["en"],
      description: "Cycle close digest",
    },
    "sla-alert": {
      medium: "push",
      locales: ["en"],
      description: "SLA high-risk / breached",
    },
    "project-update": {
      medium: "email",
      locales: ["en"],
      description: "Project health update",
    },
    ...KEEL_SURFACE_CHANNELS,
  },
  ai: {
    models: {
      smart: { provider: "openai", tier: "smart", model: "gpt-4.1" },
      fast: { provider: "openai", tier: "fast", model: "gpt-4.1-mini" },
    },
    prompts: {
      "issue-triage": {
        version: 3,
        model: "smart",
        via: ["smart", "fast"],
        timeout: "30s",
        budget: { maxCostPerCall: 0.02 },
        evals: "./evals/triage.jsonl",
      },
      "cycle-summary": {
        version: 1,
        model: "fast",
        via: ["fast"],
        timeout: "15s",
        budget: { maxCostPerCall: 0.005 },
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
      triage: {
        tools: [
          "issues.list",
          "issues.get",
          "issues.create",
          "issues.update",
          "issues.assign",
          "comments.create",
          "comments.list",
          "triage.inbox",
          "search.query",
        ],
        maxSteps: 8,
        model: "smart",
        budget: { maxCostPerRun: 0.25 },
      },
    },
  },
};
