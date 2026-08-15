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

/** Triage snooze until timestamps. */
export const snoozeKv = store.kv("triage-snooze", { description: "Triage snooze" });

/** Outbound webhook registrations. */
export const webhooksKv = store.kv("webhooks", { description: "Outbound webhooks" });

/** Issue attachments. */
export const attachments = store.files("attachments", {
  description: "Issue attachments (specs, screenshots)",
});

/** Semantic / full-text issue search. */
export const issueIndex = store.index("issues", { description: "Issue search" });

// --- Gate --------------------------------------------------------------------

/** Signed-in workspace member. */
export const member = gate.policy("member", {
  description: "Signed-in workspace member",
  check: ({ auth }) => !!auth.verified,
});

/** May create and update issues. */
export const issueWrite = gate.scope("issue:write");

/** May create projects. */
export const projectAdmin = gate.scope("project:admin");

/** May accept issues out of triage. */
export const triageAccept = gate.scope("triage:accept");

/** May create teams and close cycles. */
export const teamAdmin = gate.scope("team:admin");

/** May edit and resolve comments. */
export const commentWrite = gate.scope("comment:write");

/** May replace or delete attachments. */
export const filesWrite = gate.scope("files:write");

/** May invite and remove members. */
export const memberAdmin = gate.scope("member:admin");

/** May manage outbound webhooks. */
export const webhookAdmin = gate.scope("webhook:admin");

/** Issue write throttle. */
export const issuesWriteRate = gate.rate({
  strategy: "sliding-window-counter",
  max: 60,
  per: "1m",
  keyBy: "user",
  description: "Issue write throttle",
});

/** Comment write throttle. */
export const commentsWriteRate = gate.rate({
  strategy: "sliding-window-counter",
  max: 120,
  per: "1m",
  keyBy: "user",
  description: "Comment write throttle",
});

/** Label mutation throttle. */
export const labelsWriteRate = gate.rate({
  strategy: "token-bucket",
  max: 40,
  per: "1m",
  keyBy: "user",
  description: "Label mutation throttle",
});

/** Policies + rates passed to `oke({ gate })`. */
export const KEEL_GATES = [
  member,
  issueWrite,
  projectAdmin,
  triageAccept,
  teamAdmin,
  commentWrite,
  filesWrite,
  memberAdmin,
  webhookAdmin,
  issuesWriteRate,
  commentsWriteRate,
  labelsWriteRate,
] as const;

// --- Vault -------------------------------------------------------------------

/** GitHub Issues sync token (stub ingest — never called outbound). */
export const githubToken = vault.secret("GITHUB_TOKEN", {
  description: "GitHub Issues sync token",
  rotate: "90d",
  dev: "ghp_dev_keel_github_sync",
});

/** Issue triage model key. */
export const openaiKey = vault.secret("OPENAI_KEY", {
  description: "Issue triage model key",
  rotate: "90d",
  dev: "sk-dev-keel-triage",
});

/** Cycle digest incoming webhook. */
export const slackWebhook = vault.secret("SLACK_WEBHOOK", {
  description: "Cycle digest incoming webhook",
  rotate: "90d",
  dev: "https://hooks.slack.test/keel/cycle-digest",
});

/** Slack ask-intake bot token (stub ingest). */
export const slackBot = vault.secret("SLACK_BOT", {
  description: "Slack ask-intake bot token",
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

// --- Channel -----------------------------------------------------------------

const mail = channel.email({ from: "Keel <keel@localhost>" });

/** Assignee notification. */
export const issueAssignedMail = mail.template("issue-assigned", {
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
    issueId: z.string(),
    body: z.string(),
  }),
});

/** Cycle close digest. */
export const cycleDigestMail = mail.template("cycle-digest", {
  locales: ["en"],
  description: "Cycle close digest",
  schema: z.object({
    cycleId: z.string(),
    name: z.string(),
    leftover: z.number(),
    summary: z.string(),
  }),
});

/** Project health update. */
export const projectUpdateMail = mail.template("project-update", {
  locales: ["en"],
  description: "Project health update",
  schema: z.object({
    projectId: z.string(),
    name: z.string(),
    health: z.string(),
  }),
});

/** Morning inbox + cycle digest. */
export const dailyDigestMail = mail.template("daily-digest", {
  locales: ["en", "ar"],
  description: "Morning inbox + cycle digest",
  schema: z.object({
    open: z.number(),
    at: z.number(),
  }),
});

/** New subscriber confirmation. */
export const issueSubscribedMail = mail.template("issue-subscribed", {
  locales: ["en"],
  description: "New subscriber confirmation",
  schema: z.object({
    id: z.string(),
    identifier: z.string(),
  }),
});

/** SLA high-risk / breached (email — push has no default driver). */
export const slaAlertMail = mail.template("sla-alert", {
  locales: ["en"],
  description: "SLA high-risk / breached",
  schema: z.object({
    id: z.string(),
    identifier: z.string(),
    title: z.string(),
  }),
});

/** Vault contracts passed to `oke({ secrets })` — configs are not auto-registered. */
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

/** Channel templates passed to `oke({ channel })` so the test harness sees them. */
export const KEEL_TEMPLATES = [
  issueAssignedMail,
  mentionReplyMail,
  cycleDigestMail,
  projectUpdateMail,
  dailyDigestMail,
  issueSubscribedMail,
  slaAlertMail,
] as const;

// --- Clock -------------------------------------------------------------------

/** Monday cycle rollover. */
export const closeCyclesClock = clock("close-cycles", {
  cron: "0 3 * * 1",
  timezone: "UTC",
  description: "Monday cycle rollover",
});

/** Expire stale compose drafts. */
export const expireDraftsClock = clock("expire-drafts", {
  every: "10m",
  timezone: "UTC",
  overridable: true,
  description: "Expire stale compose drafts",
});

/** Scan issue SLA high-risk / breached. */
export const watchSlaClock = clock("watch-sla", {
  every: "15m",
  timezone: "UTC",
  description: "Scan issue SLA high-risk / breached",
});

/** Morning cycle + inbox digest. */
export const dailyDigestClock = clock("daily-digest", {
  cron: "0 8 * * *",
  timezone: "UTC",
  description: "Morning cycle + inbox digest",
});

/** Nudge issues idle past SLA warn. */
export const nudgeStaleClock = clock("nudge-stale", {
  every: "1h",
  timezone: "UTC",
  description: "Nudge issues idle past SLA warn",
});

/** Reconcile GitHub Issues drift (stub). */
export const reconcileGithubClock = clock("reconcile-github", {
  cron: "0 */6 * * *",
  timezone: "UTC",
  description: "Reconcile GitHub Issues drift",
});

/** Clocks passed to `oke()` — no auto-registry. */
export const KEEL_CLOCKS = [
  closeCyclesClock,
  expireDraftsClock,
  watchSlaClock,
  dailyDigestClock,
  nudgeStaleClock,
  reconcileGithubClock,
] as const;

/** KV / index facets — not auto-registered. */
export const KEEL_EXTRA_STORES = [draftsKv, snoozeKv, webhooksKv, issueIndex] as const;

// --- AI ----------------------------------------------------------------------

const smart = ai.model("smart", { provider: "mock", tier: "smart", model: "gpt-4.1" });
const fast = ai.model("fast", { provider: "mock", tier: "fast", model: "gpt-4.1-mini" });

/** Issue triage prompt. */
export const issueTriagePrompt = smart.prompt("issue-triage", {
  version: 3,
  via: ["smart", "fast"],
  timeout: "30s",
  budget: { maxCostPerCall: 0.02 },
  out: z.object({
    state: z.string(),
    priority: z.number(),
    summary: z.string(),
  }),
});

/** Cycle close summary. */
export const cycleSummaryPrompt = fast.prompt("cycle-summary", {
  version: 1,
  via: ["fast"],
  timeout: "15s",
  budget: { maxCostPerCall: 0.005 },
  out: z.object({ summary: z.string() }),
});

/** Document summary. */
export const documentSummaryPrompt = fast.prompt("document-summary", {
  version: 1,
  via: ["fast"],
  timeout: "20s",
  budget: { maxCostPerCall: 0.008 },
  out: z.object({ summary: z.string() }),
});

/** Triage agent — tools are keel flows. */
export const triageAgent = ai.agent("triage", {
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
});
