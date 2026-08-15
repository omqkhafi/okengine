/**
 * App core — element wiring loaded by `import "@/core"` from `app.ts`.
 *
 * Order: locales → store → gate → vault → channel → clock → AI.
 */

import "@/locales";

import { ai, channel, clock, gate, store, vault } from "okengine";
import { z } from "zod";
import * as schema from "@/db/schema.decl";

// --- Store -------------------------------------------------------------------

/** Primary keel SQL. */
export const db = store.sql("db", { schema, description: "Primary keel SQL" });

/** Compose drafts. */
export const draftsKv = store.kv("drafts", { description: "Compose drafts" });

/** Saved view preferences. */
export const viewPrefsKv = store.kv("view-prefs", { description: "Saved view preferences" });

/** Due-date reminder snoozes. */
export const remindersKv = store.kv("reminders", { description: "Due-date reminders" });

/** Outbound webhook registrations. */
export const webhooksKv = store.kv("webhooks", { description: "Outbound webhooks" });

/** Task attachments. */
export const attachments = store.files("attachments", {
  description: "Task attachments (specs, screenshots)",
});

/** Semantic / full-text task search. */
export const taskIndex = store.index("tasks", { description: "Task search" });

// --- Gate --------------------------------------------------------------------

/** Signed-in workspace member. */
export const member = gate.policy("member", {
  description: "Signed-in workspace member",
  check: ({ auth }) => !!auth.verified,
});

/** May create and update tasks. */
export const taskWrite = gate.scope("task:write");

/** May create projects, views, and forms. */
export const projectAdmin = gate.scope("project:admin");

/** May edit and resolve comments. */
export const commentWrite = gate.scope("comment:write");

/** May replace or delete attachments. */
export const filesWrite = gate.scope("files:write");

/** May invite and remove members. */
export const memberAdmin = gate.scope("member:admin");

/** May manage outbound webhooks. */
export const webhookAdmin = gate.scope("webhook:admin");

/** Task write throttle. */
export const tasksWriteRate = gate.rate({
  strategy: "sliding-window-counter",
  max: 60,
  per: "1m",
  keyBy: "user",
  description: "Task write throttle",
});

/** Comment write throttle. */
export const commentsWriteRate = gate.rate({
  strategy: "sliding-window-counter",
  max: 120,
  per: "1m",
  keyBy: "user",
  description: "Comment write throttle",
});

/** Form / view mutation throttle. */
export const pmWriteRate = gate.rate({
  strategy: "token-bucket",
  max: 40,
  per: "1m",
  keyBy: "user",
  description: "PM mutation throttle",
});

/** Developer + PM task mutate chain. */
export const tasksWrite = gate.all(member, taskWrite, tasksWriteRate);

/** Comment edit / resolve chain (guests included when they hold the scope). */
export const commentsWrite = gate.all(member, commentWrite, commentsWriteRate);

/** Project / view / form / goal admin write chain. */
export const projectAdminWrite = gate.all(member, projectAdmin, pmWriteRate);

/** Member invite / admin write chain. */
export const memberAdminWrite = gate.all(member, memberAdmin);

/** Webhook admin write chain. */
export const webhookAdminWrite = gate.all(member, webhookAdmin);

/** Policies + rates passed to `oke({ gate })`. */
export const KEEL_GATES = [
  member,
  taskWrite,
  projectAdmin,
  commentWrite,
  filesWrite,
  memberAdmin,
  webhookAdmin,
  tasksWriteRate,
  commentsWriteRate,
  pmWriteRate,
  tasksWrite,
  commentsWrite,
  projectAdminWrite,
  memberAdminWrite,
  webhookAdminWrite,
] as const;

// --- Vault -------------------------------------------------------------------

/** GitHub PR / issue intake token (stub ingest — never called outbound). */
export const githubToken = vault.secret("GITHUB_TOKEN", {
  description: "GitHub PR intake token",
  rotate: "90d",
  dev: "ghp_dev_keel_github_sync",
});

/** Task suggest / planner model key. */
export const openaiKey = vault.secret("OPENAI_KEY", {
  description: "Task planner model key",
  rotate: "90d",
  dev: "sk-dev-keel-planner",
});

/** Goal digest incoming webhook. */
export const slackWebhook = vault.secret("SLACK_WEBHOOK", {
  description: "Goal digest incoming webhook",
  rotate: "90d",
  dev: "https://hooks.slack.test/keel/goal-digest",
});

/** Slack form-intake bot token (stub ingest). */
export const slackBot = vault.secret("SLACK_BOT", {
  description: "Slack form-intake bot token",
  rotate: "90d",
  dev: "xoxb-dev-keel-intake",
});

/** Outbound webhook HMAC signing key. */
export const webhookSecret = vault.secret("WEBHOOK_SECRET", {
  description: "Outbound webhook HMAC signing key",
  rotate: "never",
  dev: "whsec_dev_keel_outbound",
});

/** Public Keel origin. */
export const publicAppUrl = vault.config("PUBLIC_APP_URL", {
  description: "Public Keel origin",
  dev: "http://127.0.0.1:6530",
});

/** Public API origin. */
export const publicApiUrl = vault.config("PUBLIC_API_URL", {
  description: "Public API origin",
  dev: "http://127.0.0.1:6530/api",
});

/** Public docs origin. */
export const publicDocsUrl = vault.config("PUBLIC_DOCS_URL", {
  description: "Public docs origin",
  dev: "http://127.0.0.1:3000/docs",
});

/** Workspace slug. */
export const keelWorkspace = vault.config("KEEL_WORKSPACE", {
  description: "Workspace slug",
  dev: "keel",
});

/** Vault contracts passed to `oke({ secrets })`. */
export const KEEL_VAULT = [
  githubToken,
  openaiKey,
  slackWebhook,
  slackBot,
  webhookSecret,
  publicAppUrl,
  publicApiUrl,
  publicDocsUrl,
  keelWorkspace,
] as const;

// --- Channel -----------------------------------------------------------------

const mail = channel.email({ from: "Keel <keel@localhost>" });

/** Assignee notification. */
export const taskAssignedMail = mail.template("task-assigned", {
  locales: ["en"],
  description: "Assignee notification",
  schema: z.object({
    id: z.string(),
    identifier: z.string(),
    title: z.string(),
    email: z.string(),
  }),
});

/** Comment mention reply. */
export const mentionReplyMail = mail.template("mention-reply", {
  locales: ["en", "ar"],
  description: "Comment mention reply",
  schema: z.object({
    id: z.string(),
    taskId: z.string(),
    body: z.string(),
  }),
});

/** Overdue task. */
export const taskOverdueMail = mail.template("task-overdue", {
  locales: ["en"],
  description: "Overdue task",
  schema: z.object({
    id: z.string(),
    identifier: z.string(),
    title: z.string(),
  }),
});

/** Morning inbox + goal digest. */
export const dailyDigestMail = mail.template("daily-digest", {
  locales: ["en", "ar"],
  description: "Morning inbox + goal digest",
  schema: z.object({
    open: z.number(),
    at: z.number(),
  }),
});

/** Form intake received. */
export const formReceivedMail = mail.template("form-received", {
  locales: ["en"],
  description: "Form intake received",
  schema: z.object({
    formId: z.string(),
    taskId: z.string(),
    customerName: z.string(),
  }),
});

/** Goal health at risk. */
export const goalAtRiskMail = mail.template("goal-at-risk", {
  locales: ["en"],
  description: "Goal health at risk",
  schema: z.object({
    goalId: z.string(),
    name: z.string(),
    status: z.string(),
  }),
});

/** Channel templates passed to `oke({ channel })`. */
export const KEEL_TEMPLATES = [
  taskAssignedMail,
  mentionReplyMail,
  taskOverdueMail,
  dailyDigestMail,
  formReceivedMail,
  goalAtRiskMail,
] as const;

// --- Clock -------------------------------------------------------------------

/** Expire stale compose drafts. */
export const expireDraftsClock = clock("expire-drafts", {
  every: "10m",
  timezone: "UTC",
  overridable: true,
  description: "Expire stale compose drafts",
});

/** Scan overdue tasks. */
export const watchOverdueClock = clock("watch-overdue", {
  every: "15m",
  timezone: "UTC",
  description: "Scan overdue tasks",
});

/** Morning inbox + goal digest. */
export const dailyDigestClock = clock("daily-digest", {
  cron: "0 8 * * *",
  every: "1d",
  timezone: "UTC",
  description: "Morning inbox + goal digest",
});

/** Spawn recurring task occurrences. */
export const spawnRecurringClock = clock("spawn-recurring", {
  every: "1h",
  timezone: "UTC",
  description: "Spawn recurring task occurrences",
});

/** Weekly goal rollup. */
export const rollupGoalsClock = clock("rollup-goals", {
  cron: "0 9 * * 1",
  every: "7d",
  timezone: "UTC",
  description: "Weekly goal rollup",
});

/** Clocks passed to `oke()` — wired as `on(every(interval), flow("unit.clock-name"))`. */
export const KEEL_CLOCKS = [
  expireDraftsClock,
  watchOverdueClock,
  dailyDigestClock,
  spawnRecurringClock,
  rollupGoalsClock,
] as const;

/** KV / index facets — not auto-registered. */
export const KEEL_EXTRA_STORES = [
  draftsKv,
  viewPrefsKv,
  remindersKv,
  webhooksKv,
  taskIndex,
] as const;

// --- AI ----------------------------------------------------------------------

const chatModel = process.env.OKE_AI_MODEL?.trim() || "granite3.3:2b";

const smart = ai.model("smart", {
  provider: "openai-compatible",
  tier: "smart",
  model: chatModel,
});
const fast = ai.model("fast", {
  provider: "openai-compatible",
  tier: "fast",
  model: chatModel,
});

/** Task suggest — priority, section, role needed. */
export const taskSuggestPrompt = smart.prompt("task-suggest", {
  version: 1,
  via: ["smart", "fast"],
  timeout: "30s",
  budget: { maxCostPerCall: 0.02 },
  out: z.object({
    priority: z.number(),
    section: z.string(),
    roleNeeded: z.string(),
    summary: z.string(),
  }),
});

/** Weekly workspace summary. */
export const weeklySummaryPrompt = fast.prompt("weekly-summary", {
  version: 1,
  via: ["fast"],
  timeout: "15s",
  budget: { maxCostPerCall: 0.005 },
  out: z.object({ summary: z.string() }),
});

/** Form intake classify. */
export const formClassifyPrompt = fast.prompt("form-classify", {
  version: 1,
  via: ["fast"],
  timeout: "20s",
  budget: { maxCostPerCall: 0.008 },
  out: z.object({
    title: z.string(),
    roleNeeded: z.string(),
    priority: z.number(),
  }),
});

/** Document summary. */
export const documentSummaryPrompt = fast.prompt("document-summary", {
  version: 1,
  via: ["fast"],
  timeout: "20s",
  budget: { maxCostPerCall: 0.008 },
  out: z.object({ summary: z.string() }),
});

/** Planner agent — tools are keel flows. */
export const plannerAgent = ai.agent("planner", {
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
});
