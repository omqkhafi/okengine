/**
 * Featured + operational WideEvents for the keel Console seed.
 *
 * Featured chain: github.ingest → tasks.create → notify.onTask.
 * Ops traffic is deterministic (mulberry32) and stays older than the
 * featured cluster so Playwright-stable rows sit near the top.
 */

import type { WideEvent } from "../../runs/types.ts";

/** Stable run id for the successful `tasks.create` WideEvent (Playwright). */
export const UI_NEXT_SEED_RUN_ID = "pw-run-tasks-create";

/** Child notify run linked via `parentId` to {@link UI_NEXT_SEED_RUN_ID}. */
export const UI_NEXT_SEED_NOTIFY_RUN_ID = "pw-run-notify-on-task";

/** Parent GitHub ingest run that `call`s into {@link UI_NEXT_SEED_RUN_ID}. */
export const UI_NEXT_SEED_INGEST_RUN_ID = "pw-run-github-ingest";

/** Failed sibling `tasks.create` (`Forbidden`). */
export const UI_NEXT_SEED_FAIL_RUN_ID = "pw-run-tasks-create-fail";

/** Recent live `tasks.list` poll. */
export const UI_NEXT_SEED_LIST_RUN_ID = "pw-run-tasks-list";

/** Morning inbox + goal digest (cron / clock). */
export const UI_NEXT_SEED_DIGEST_RUN_ID = "pw-run-digest-daily";

/** Planner Intelligence with Vault secret + AI ask + channel send. */
export const UI_NEXT_SEED_PLAN_RUN_ID = "pw-run-my-plan";

/** Draft expiry driven by a named Clock (`every: 10m`). */
export const UI_NEXT_SEED_DRAFTS_RUN_ID = "pw-run-drafts-expire";

/**
 * How many extra operational WideEvents to generate beyond the featured story.
 * Featured (8) + operations (72) = 80 traces — inside the 50–100 band.
 */
export const UI_NEXT_SEED_OPERATION_COUNT = 72;

/** Featured story run count (all eight elements exercised). */
export const UI_NEXT_SEED_FEATURED_COUNT = 8;

/** Total seeded traces ({@link UI_NEXT_SEED_FEATURED_COUNT} + operations). */
export const UI_NEXT_SEED_TOTAL_COUNT = UI_NEXT_SEED_FEATURED_COUNT + UI_NEXT_SEED_OPERATION_COUNT;

const BUILD = "0.11.2";
const OPS_TENANTS = ["ws_keel", "ws_harbor", "ws_atlas", "ws_nova"] as const;
const OPS_USERS = ["user_aria", "user_ben", "user_cai", "user_dia", "user_eli"] as const;
const OPS_SPACES = ["ENG", "DES", "GTM"] as const;
const OPS_TITLES = [
  "SSO login fails",
  "Billing webhook",
  "RTL checkout labels",
  "Replica lag banner",
  "Weekly launch review",
  "Checkout polish",
] as const;

/**
 * Tiny deterministic PRNG so operational seeds are stable across boots/tests.
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

/**
 * Build the seeded WideEvent chain (ingest → create → notify, plus
 * fail / list / digest / plan / drafts siblings).
 *
 * @param now - Clock ms (defaults to `Date.now()`)
 */
export function createUiNextSeedRuns(now: number = Date.now()): readonly WideEvent[] {
  const createStart = now - 42_000;
  const createEnd = createStart + 48;
  const notifyStart = createEnd + 120;
  const notifyEnd = notifyStart + 132;
  const ingestStart = createStart - 18;
  const ingestEnd = createEnd + 6;
  const failStart = now - 6 * 60_000;
  const failEnd = failStart + 31;
  const listStart = now - 8_000;
  const listEnd = listStart + 14;
  const digestStart = now - 3 * 60 * 60_000;
  const digestEnd = digestStart + 890;

  const ingest: WideEvent = {
    id: UI_NEXT_SEED_INGEST_RUN_ID,
    flow: "github.ingest",
    unit: "github",
    trigger: "http",
    plane: "user",
    tenant: "ws_keel",
    principal: "user_aria",
    subjectId: "user_aria",
    gates: ["member"],
    cache: "miss",
    replica: "primary",
    buildVersion: BUILD,
    input: {
      repo: "keel/okengine",
      action: "opened",
      title: "SSO login fails",
      spaceKey: "ENG",
    },
    output: { identifier: "ENG-12", taskId: "tsk_eng_12", status: "synced" },
    effects: [
      {
        kind: "secret",
        resource: "GITHUB_TOKEN",
        timestamp: ingestStart + 2,
        duration: 1,
        reversibility: "capability",
      },
      {
        kind: "call",
        resource: "tasks.create",
        timestamp: ingestStart + 8,
        duration: createEnd - createStart,
        reversibility: "portal",
      },
    ],
    logs: [
      {
        level: "info",
        message: "github webhook accepted",
        data: { repo: "keel/okengine", action: "opened" },
        at: ingestStart + 1,
      },
      {
        level: "info",
        message: "synced task from pull request",
        data: { identifier: "ENG-12" },
        at: ingestEnd - 4,
      },
    ],
    durationMs: ingestEnd - ingestStart,
    startedAt: ingestStart,
    endedAt: ingestEnd,
    dimensions: {
      flow: "github.ingest",
      unit: "github",
      tenant: "ws_keel",
      cache: "miss",
      duration_ms: ingestEnd - ingestStart,
      build_version: BUILD,
    },
  };

  const createOk: WideEvent = {
    id: UI_NEXT_SEED_RUN_ID,
    parentId: UI_NEXT_SEED_INGEST_RUN_ID,
    flow: "tasks.create",
    unit: "tasks",
    trigger: "http",
    plane: "user",
    tenant: "ws_keel",
    principal: "user_aria",
    subjectId: "user_aria",
    gates: ["member", "task:write"],
    cache: "hit",
    replica: "primary",
    buildVersion: BUILD,
    input: {
      title: "SSO login fails",
      spaceKey: "ENG",
      priority: 1,
    },
    output: { id: "tsk_eng_12", identifier: "ENG-12" },
    effects: [
      {
        kind: "read",
        resource: "sql:tasks",
        timestamp: createStart + 3,
        duration: 9,
        reversibility: "none",
      },
      {
        kind: "write",
        resource: "sql:tasks",
        timestamp: createStart + 14,
        duration: 18,
        reversibility: "reversible",
      },
      {
        kind: "emit",
        resource: "task-created",
        timestamp: createStart + 36,
        duration: 5,
        reversibility: "deferred",
      },
    ],
    logs: [
      {
        level: "info",
        message: "task create started",
        data: { spaceKey: "ENG", title: "SSO login fails" },
        at: createStart + 1,
      },
      {
        level: "info",
        message: "task reserved",
        data: { identifier: "ENG-12" },
        at: createStart + 32,
      },
      {
        level: "debug",
        message: "emitted task-created",
        at: createStart + 40,
      },
    ],
    durationMs: createEnd - createStart,
    startedAt: createStart,
    endedAt: createEnd,
    dimensions: {
      flow: "tasks.create",
      unit: "tasks",
      tenant: "ws_keel",
      cache: "hit",
      space_key: "ENG",
      identifier: "ENG-12",
      priority: 1,
      duration_ms: createEnd - createStart,
      build_version: BUILD,
    },
  };

  const notify: WideEvent = {
    id: UI_NEXT_SEED_NOTIFY_RUN_ID,
    parentId: UI_NEXT_SEED_RUN_ID,
    flow: "notify.onTask",
    unit: "notify",
    trigger: "signal",
    plane: "user",
    tenant: "ws_keel",
    principal: "user_aria",
    subjectId: "user_aria",
    gates: [],
    cache: "none",
    buildVersion: BUILD,
    input: { signal: "task-created", identifier: "ENG-12" },
    output: { identifier: "ENG-12", assigned: true, template: "task-assigned" },
    effects: [
      {
        kind: "write",
        resource: "sql:inbox",
        timestamp: notifyStart + 8,
        duration: 22,
        reversibility: "reversible",
      },
      {
        kind: "send",
        resource: "task-assigned",
        timestamp: notifyStart + 40,
        duration: 78,
        reversibility: "irreversible",
      },
    ],
    logs: [
      {
        level: "info",
        message: "notify consumed task-created",
        data: { identifier: "ENG-12" },
        at: notifyStart + 2,
      },
      {
        level: "info",
        message: "assignment email queued",
        data: { template: "task-assigned", locale: "en" },
        at: notifyStart + 110,
      },
    ],
    durationMs: notifyEnd - notifyStart,
    startedAt: notifyStart,
    endedAt: notifyEnd,
    dimensions: {
      flow: "notify.onTask",
      unit: "notify",
      tenant: "ws_keel",
      cache: "none",
      signal: "task-created",
      duration_ms: notifyEnd - notifyStart,
      build_version: BUILD,
    },
  };

  const createFail: WideEvent = {
    id: UI_NEXT_SEED_FAIL_RUN_ID,
    flow: "tasks.create",
    unit: "tasks",
    trigger: "http",
    plane: "user",
    tenant: "ws_harbor",
    principal: "user_ben",
    subjectId: "user_ben",
    gates: ["member", "task:write"],
    cache: "miss",
    replica: "replica",
    replicaLagMs: 180,
    buildVersion: BUILD,
    error: {
      code: "Forbidden",
      message: "Guest cannot create tasks in this space",
    },
    input: {
      title: "Late leftover",
      spaceKey: "ENG",
      priority: 3,
    },
    effects: [
      {
        kind: "read",
        resource: "sql:tasks",
        timestamp: failStart + 4,
        duration: 21,
        reversibility: "none",
      },
    ],
    logs: [
      {
        level: "warn",
        message: "forbidden",
        data: { code: "Forbidden", spaceKey: "ENG" },
        at: failStart + 26,
      },
    ],
    durationMs: failEnd - failStart,
    startedAt: failStart,
    endedAt: failEnd,
    dimensions: {
      flow: "tasks.create",
      unit: "tasks",
      tenant: "ws_harbor",
      cache: "miss",
      error_code: "Forbidden",
      replica: "replica",
      replica_lag_ms: 180,
      space_key: "ENG",
      duration_ms: failEnd - failStart,
      build_version: BUILD,
    },
  };

  const list: WideEvent = {
    id: UI_NEXT_SEED_LIST_RUN_ID,
    flow: "tasks.list",
    unit: "tasks",
    trigger: "http",
    plane: "user",
    tenant: "ws_keel",
    principal: "user_aria",
    subjectId: "user_aria",
    gates: ["member"],
    cache: "hit",
    replica: "replica",
    replicaLagMs: 12,
    buildVersion: BUILD,
    output: {
      count: 3,
      tasks: [
        { id: "tsk_eng_12", identifier: "ENG-12" },
        { id: "tsk_eng_13", identifier: "ENG-13" },
        { id: "tsk_eng_8", identifier: "ENG-8" },
      ],
    },
    effects: [
      {
        kind: "read",
        resource: "sql:tasks",
        timestamp: listStart + 2,
        duration: 8,
        reversibility: "none",
      },
    ],
    logs: [
      {
        level: "debug",
        message: "listed tasks for principal",
        data: { count: 3 },
        at: listStart + 10,
      },
    ],
    durationMs: listEnd - listStart,
    startedAt: listStart,
    endedAt: listEnd,
    dimensions: {
      flow: "tasks.list",
      unit: "tasks",
      tenant: "ws_keel",
      cache: "hit",
      replica: "replica",
      duration_ms: listEnd - listStart,
      build_version: BUILD,
    },
  };

  const digest: WideEvent = {
    id: UI_NEXT_SEED_DIGEST_RUN_ID,
    flow: "digest.daily",
    unit: "digest",
    trigger: "cron",
    plane: "operator",
    tenant: null,
    principal: "ops_bot",
    gates: [],
    cache: "none",
    replica: "primary",
    cost: 0.004,
    promptVersion: 1,
    buildVersion: BUILD,
    output: { open: 24, at: digestStart },
    effects: [
      {
        kind: "read",
        resource: "sql:tasks",
        timestamp: digestStart + 20,
        duration: 210,
        reversibility: "none",
      },
      {
        kind: "secret",
        resource: "SLACK_WEBHOOK",
        timestamp: digestStart + 700,
        duration: 1,
        reversibility: "capability",
      },
      {
        kind: "ask",
        resource: "weekly-summary@1",
        timestamp: digestStart + 710,
        duration: 80,
        reversibility: "irreversible",
      },
      {
        kind: "send",
        resource: "daily-digest",
        timestamp: digestStart + 820,
        duration: 40,
        reversibility: "irreversible",
      },
    ],
    logs: [
      {
        level: "info",
        message: "daily digest started",
        at: digestStart + 1,
      },
      {
        level: "info",
        message: "morning inbox + goal digest queued",
        data: { open: 24 },
        at: digestEnd - 20,
      },
    ],
    durationMs: digestEnd - digestStart,
    startedAt: digestStart,
    endedAt: digestEnd,
    dimensions: {
      flow: "digest.daily",
      unit: "digest",
      plane: "operator",
      cache: "none",
      clock: "daily-digest",
      duration_ms: digestEnd - digestStart,
      build_version: BUILD,
    },
  };

  const planStart = now - 95_000;
  const planEnd = planStart + 420;
  const plan: WideEvent = {
    id: UI_NEXT_SEED_PLAN_RUN_ID,
    flow: "my.plan",
    unit: "my",
    trigger: "http",
    plane: "user",
    tenant: "ws_keel",
    principal: "user_aria",
    subjectId: "user_aria",
    gates: ["member"],
    cache: "none",
    cost: 0.014,
    promptVersion: 1,
    buildVersion: BUILD,
    input: {
      identifier: "ENG-12",
      message: "Classify the Harbor Logistics form intake",
    },
    output: {
      title: "SSO login fails",
      roleNeeded: "developer",
      priority: 1,
      replyQueued: true,
      template: "mention-reply",
    },
    effects: [
      {
        kind: "read",
        resource: "sql:inbox",
        timestamp: planStart + 4,
        duration: 12,
        reversibility: "none",
      },
      {
        kind: "secret",
        resource: "OPENAI_KEY",
        timestamp: planStart + 18,
        duration: 1,
        reversibility: "capability",
      },
      {
        kind: "ask",
        resource: "form-classify@1",
        timestamp: planStart + 22,
        duration: 340,
        reversibility: "irreversible",
      },
      {
        kind: "send",
        resource: "mention-reply",
        timestamp: planStart + 370,
        duration: 40,
        reversibility: "irreversible",
      },
    ],
    logs: [
      {
        level: "info",
        message: "plan started",
        data: { identifier: "ENG-12" },
        at: planStart + 2,
      },
      {
        level: "info",
        message: "prompt form-classify@1 answered",
        data: { via: "fast", cost: 0.014 },
        at: planStart + 360,
      },
      {
        level: "info",
        message: "mention-reply queued",
        data: { template: "mention-reply", locale: "en" },
        at: planStart + 400,
      },
    ],
    durationMs: planEnd - planStart,
    startedAt: planStart,
    endedAt: planEnd,
    dimensions: {
      flow: "my.plan",
      unit: "my",
      tenant: "ws_keel",
      cache: "none",
      prompt: "form-classify",
      prompt_version: 1,
      cost: 0.014,
      duration_ms: planEnd - planStart,
      build_version: BUILD,
    },
  };

  const draftsStart = now - 12 * 60_000;
  const draftsEnd = draftsStart + 55;
  const drafts: WideEvent = {
    id: UI_NEXT_SEED_DRAFTS_RUN_ID,
    flow: "drafts.expire-drafts",
    unit: "drafts",
    trigger: "every",
    plane: "operator",
    tenant: null,
    principal: "clock_bot",
    gates: [],
    cache: "none",
    buildVersion: BUILD,
    output: { expired: 4 },
    effects: [
      {
        kind: "read",
        resource: "kv:drafts",
        timestamp: draftsStart + 3,
        duration: 8,
        reversibility: "none",
      },
      {
        kind: "write",
        resource: "kv:drafts",
        timestamp: draftsStart + 14,
        duration: 18,
        reversibility: "reversible",
      },
      {
        kind: "emit",
        resource: "draft-expired",
        timestamp: draftsStart + 38,
        duration: 6,
        reversibility: "deferred",
      },
    ],
    logs: [
      {
        level: "info",
        message: "expire-drafts tick",
        data: { clock: "expire-drafts", expired: 4 },
        at: draftsStart + 1,
      },
    ],
    durationMs: draftsEnd - draftsStart,
    startedAt: draftsStart,
    endedAt: draftsEnd,
    dimensions: {
      flow: "drafts.expire-drafts",
      unit: "drafts",
      plane: "operator",
      cache: "none",
      clock: "expire-drafts",
      duration_ms: draftsEnd - draftsStart,
      build_version: BUILD,
    },
  };

  return [
    ingest,
    createOk,
    notify,
    createFail,
    list,
    digest,
    plan,
    drafts,
    ...createUiNextOperationRuns(now, UI_NEXT_SEED_OPERATION_COUNT),
  ];
}

/**
 * Build background operational traffic so Traces looks like a live workspace.
 *
 * Times are intentionally older than the featured story cluster (~last minute)
 * so the Playwright-stable chain stays near the top of the newest-first list.
 *
 * @param now - Clock ms
 * @param count - How many operational events to emit (default {@link UI_NEXT_SEED_OPERATION_COUNT})
 */
export function createUiNextOperationRuns(
  now: number = Date.now(),
  count: number = UI_NEXT_SEED_OPERATION_COUNT,
): readonly WideEvent[] {
  const rand = mulberry32(0x5eed_0ce1 ^ count);
  const out: WideEvent[] = [];
  const newestOpsOffsetMs = 90_000;
  const oldestOpsOffsetMs = 6 * 60 * 60_000;

  let i = 0;
  while (out.length < count) {
    const roll = rand();
    const age = newestOpsOffsetMs + Math.floor(rand() * (oldestOpsOffsetMs - newestOpsOffsetMs));
    const startedAt = now - age;
    const tenant = OPS_TENANTS[Math.floor(rand() * OPS_TENANTS.length)]!;
    const principal = OPS_USERS[Math.floor(rand() * OPS_USERS.length)]!;
    const spaceKey = OPS_SPACES[Math.floor(rand() * OPS_SPACES.length)]!;
    const title = OPS_TITLES[Math.floor(rand() * OPS_TITLES.length)]!;
    const seq = String(i).padStart(3, "0");
    const identifier = `${spaceKey}-${100 + i}`;

    if (roll < 0.22) {
      const durationMs = 8 + Math.floor(rand() * 40);
      const endedAt = startedAt + durationMs;
      const cache = rand() < 0.7 ? "hit" : "miss";
      out.push({
        id: `pw-ops-list-${seq}`,
        flow: "tasks.list",
        unit: "tasks",
        trigger: "http",
        plane: "user",
        tenant,
        principal,
        subjectId: principal,
        gates: ["member"],
        cache,
        replica: cache === "hit" ? "replica" : "primary",
        replicaLagMs: cache === "hit" ? 8 + Math.floor(rand() * 40) : undefined,
        buildVersion: BUILD,
        effects: [
          {
            kind: "read",
            resource: "sql:tasks",
            timestamp: startedAt + 2,
            duration: Math.max(2, durationMs - 4),
            reversibility: "none",
          },
        ],
        logs: [
          {
            level: "debug",
            message: "listed tasks for principal",
            data: { count: 1 + Math.floor(rand() * 8) },
            at: startedAt + 3,
          },
        ],
        durationMs,
        startedAt,
        endedAt,
        dimensions: {
          flow: "tasks.list",
          unit: "tasks",
          tenant,
          cache,
          duration_ms: durationMs,
          build_version: BUILD,
        },
      });
      i += 1;
      continue;
    }

    if (roll < 0.32) {
      const durationMs = 10 + Math.floor(rand() * 30);
      const endedAt = startedAt + durationMs;
      const kind = rand();
      const flowId =
        kind < 0.4
          ? "tasks.get"
          : kind < 0.65
            ? "projects.list"
            : kind < 0.85
              ? "comments.list"
              : "spaces.list";
      const unit = flowId.split(".")[0]!;
      const resource =
        unit === "tasks"
          ? "sql:tasks"
          : unit === "projects"
            ? "sql:projects"
            : unit === "comments"
              ? "sql:comments"
              : "sql:spaces";
      out.push({
        id: `pw-ops-read-${seq}`,
        flow: flowId,
        unit,
        trigger: "http",
        plane: "user",
        tenant,
        principal,
        subjectId: principal,
        gates: ["member"],
        cache: rand() < 0.6 ? "hit" : "miss",
        replica: "replica",
        replicaLagMs: 6 + Math.floor(rand() * 20),
        buildVersion: BUILD,
        input: flowId === "tasks.get" ? { id: `tsk_ops_${seq}` } : { spaceKey },
        output: flowId === "tasks.get" ? { id: `tsk_ops_${seq}`, identifier } : { items: [] },
        effects: [
          {
            kind: "read",
            resource,
            timestamp: startedAt + 2,
            duration: Math.max(2, durationMs - 4),
            reversibility: "none",
          },
        ],
        logs: [
          {
            level: "debug",
            message: `${flowId} served`,
            data: { identifier },
            at: startedAt + 3,
          },
        ],
        durationMs,
        startedAt,
        endedAt,
        dimensions: {
          flow: flowId,
          unit,
          tenant,
          cache: "hit",
          duration_ms: durationMs,
          build_version: BUILD,
        },
      });
      i += 1;
      continue;
    }

    if (roll < 0.52) {
      const durationMs = 28 + Math.floor(rand() * 90);
      const endedAt = startedAt + durationMs;
      const createId = `pw-ops-create-${seq}`;
      const priority = 1 + Math.floor(rand() * 4);
      out.push({
        id: createId,
        flow: "tasks.create",
        unit: "tasks",
        trigger: "http",
        plane: "user",
        tenant,
        principal,
        subjectId: principal,
        gates: ["member", "task:write"],
        cache: rand() < 0.55 ? "hit" : "miss",
        replica: "primary",
        buildVersion: BUILD,
        input: { title, spaceKey, priority },
        output: { id: `tsk_ops_${seq}`, identifier },
        effects: [
          {
            kind: "read",
            resource: "sql:tasks",
            timestamp: startedAt + 2,
            duration: 6 + Math.floor(rand() * 12),
            reversibility: "none",
          },
          {
            kind: "write",
            resource: "sql:tasks",
            timestamp: startedAt + 12,
            duration: 10 + Math.floor(rand() * 20),
            reversibility: "reversible",
          },
          {
            kind: "emit",
            resource: "task-created",
            timestamp: endedAt - 8,
            duration: 3 + Math.floor(rand() * 6),
            reversibility: "deferred",
          },
        ],
        logs: [
          {
            level: "info",
            message: "task create started",
            data: { spaceKey, title },
            at: startedAt + 1,
          },
          {
            level: "info",
            message: "task reserved",
            data: { identifier },
            at: endedAt - 10,
          },
        ],
        durationMs,
        startedAt,
        endedAt,
        dimensions: {
          flow: "tasks.create",
          unit: "tasks",
          tenant,
          cache: "hit",
          space_key: spaceKey,
          identifier,
          priority,
          duration_ms: durationMs,
          build_version: BUILD,
        },
      });
      i += 1;

      if (out.length < count && rand() < 0.65) {
        const fDur = 60 + Math.floor(rand() * 120);
        const fStart = endedAt + 40 + Math.floor(rand() * 400);
        out.push({
          id: `pw-ops-notify-${seq}`,
          parentId: createId,
          flow: "notify.onTask",
          unit: "notify",
          trigger: "signal",
          plane: "user",
          tenant,
          principal,
          subjectId: principal,
          gates: [],
          cache: "none",
          buildVersion: BUILD,
          input: { signal: "task-created", identifier },
          output: { identifier, assigned: true },
          effects: [
            {
              kind: "write",
              resource: "sql:inbox",
              timestamp: fStart + 6,
              duration: 12 + Math.floor(rand() * 20),
              reversibility: "reversible",
            },
            {
              kind: "send",
              resource: "task-assigned",
              timestamp: fStart + 30,
              duration: 40 + Math.floor(rand() * 50),
              reversibility: "irreversible",
            },
          ],
          logs: [
            {
              level: "info",
              message: "assignment email queued",
              data: { template: "task-assigned" },
              at: fStart + fDur - 8,
            },
          ],
          durationMs: fDur,
          startedAt: fStart,
          endedAt: fStart + fDur,
          dimensions: {
            flow: "notify.onTask",
            unit: "notify",
            tenant,
            cache: "none",
            signal: "task-created",
            duration_ms: fDur,
            build_version: BUILD,
          },
        });
        i += 1;
      }
      continue;
    }

    if (roll < 0.6) {
      const durationMs = 18 + Math.floor(rand() * 40);
      const endedAt = startedAt + durationMs;
      const duplicate = rand() < 0.35;
      out.push({
        id: `pw-ops-fail-${seq}`,
        flow: "tasks.create",
        unit: "tasks",
        trigger: "http",
        plane: "user",
        tenant,
        principal,
        subjectId: principal,
        gates: ["member", "task:write"],
        cache: "miss",
        replica: "replica",
        replicaLagMs: 80 + Math.floor(rand() * 200),
        buildVersion: BUILD,
        error: duplicate
          ? { code: "Duplicate", message: `${identifier} is a duplicate of ENG-12` }
          : { code: "Forbidden", message: `Guest cannot create ${identifier}` },
        input: { title, spaceKey, priority: 3 },
        effects: [
          {
            kind: "read",
            resource: "sql:tasks",
            timestamp: startedAt + 3,
            duration: Math.max(4, durationMs - 6),
            reversibility: "none",
          },
        ],
        logs: [
          {
            level: "warn",
            message: duplicate ? "duplicate task" : "forbidden",
            data: { code: duplicate ? "Duplicate" : "Forbidden", spaceKey },
            at: endedAt - 4,
          },
        ],
        durationMs,
        startedAt,
        endedAt,
        dimensions: {
          flow: "tasks.create",
          unit: "tasks",
          tenant,
          cache: "miss",
          error_code: duplicate ? "Duplicate" : "Forbidden",
          space_key: spaceKey,
          duration_ms: durationMs,
          build_version: BUILD,
        },
      });
      i += 1;
      continue;
    }

    if (roll < 0.68) {
      const durationMs = 40 + Math.floor(rand() * 160);
      const endedAt = startedAt + durationMs;
      out.push({
        id: `pw-ops-ingest-${seq}`,
        flow: "github.ingest",
        unit: "github",
        trigger: "http",
        plane: "user",
        tenant,
        principal,
        subjectId: principal,
        gates: ["member"],
        cache: "miss",
        replica: "primary",
        buildVersion: BUILD,
        input: { repo: "keel/okengine", action: "opened", title, spaceKey },
        output: { identifier, status: "synced" },
        effects: [
          {
            kind: "secret",
            resource: "GITHUB_TOKEN",
            timestamp: startedAt + 2,
            duration: 1,
            reversibility: "capability",
          },
          {
            kind: "call",
            resource: "tasks.create",
            timestamp: startedAt + 8,
            duration: Math.max(10, durationMs - 20),
            reversibility: "portal",
          },
        ],
        logs: [
          {
            level: "info",
            message: "github webhook accepted",
            data: { spaceKey },
            at: startedAt + 1,
          },
        ],
        durationMs,
        startedAt,
        endedAt,
        dimensions: {
          flow: "github.ingest",
          unit: "github",
          tenant,
          cache: "miss",
          duration_ms: durationMs,
          build_version: BUILD,
        },
      });
      i += 1;
      continue;
    }

    if (roll < 0.76) {
      const durationMs = 20 + Math.floor(rand() * 80);
      const endedAt = startedAt + durationMs;
      out.push({
        id: `pw-ops-comment-${seq}`,
        flow: "comments.create",
        unit: "comments",
        trigger: "http",
        plane: "user",
        tenant,
        principal,
        subjectId: principal,
        gates: ["member", "comment:write"],
        cache: "none",
        buildVersion: BUILD,
        input: { identifier, body: "Looks good — ship it." },
        output: { id: `cmt_ops_${seq}` },
        effects: [
          {
            kind: "write",
            resource: "sql:comments",
            timestamp: startedAt + 4,
            duration: Math.max(6, durationMs - 8),
            reversibility: "reversible",
          },
          {
            kind: "emit",
            resource: "comment-added",
            timestamp: endedAt - 6,
            duration: 4,
            reversibility: "deferred",
          },
        ],
        logs: [
          {
            level: "info",
            message: "comment posted",
            data: { identifier },
            at: endedAt - 4,
          },
        ],
        durationMs,
        startedAt,
        endedAt,
        dimensions: {
          flow: "comments.create",
          unit: "comments",
          tenant,
          cache: "none",
          signal: "comment-added",
          duration_ms: durationMs,
          build_version: BUILD,
        },
      });
      i += 1;
      continue;
    }

    if (roll < 0.84) {
      const durationMs = 18 + Math.floor(rand() * 50);
      const endedAt = startedAt + durationMs;
      const kind = rand();
      const flowId =
        kind < 0.35
          ? "tasks.archive"
          : kind < 0.6
            ? "tasks.assign"
            : kind < 0.8
              ? "search.query"
              : "drafts.save";
      const unit = flowId.split(".")[0]!;
      const resource =
        flowId === "search.query"
          ? "index:tasks"
          : flowId === "drafts.save"
            ? "kv:drafts"
            : "sql:tasks";
      out.push({
        id: `pw-ops-custom-${seq}`,
        flow: flowId,
        unit,
        trigger: "http",
        plane: "user",
        tenant,
        principal,
        subjectId: principal,
        gates: flowId.startsWith("tasks.") ? ["member", "task:write"] : ["member"],
        cache: "none",
        buildVersion: BUILD,
        input:
          flowId === "search.query"
            ? { q: title }
            : flowId === "tasks.assign"
              ? { assigneeEmail: "aria@keel.dev" }
              : { identifier },
        output: { ok: true, identifier },
        effects: [
          {
            kind: flowId === "drafts.save" || flowId.startsWith("tasks.") ? "write" : "read",
            resource,
            timestamp: startedAt + 3,
            duration: Math.max(4, durationMs - 6),
            reversibility: flowId === "search.query" ? "none" : "reversible",
          },
        ],
        logs: [
          {
            level: "info",
            message: `${flowId} ok`,
            data: { identifier },
            at: endedAt - 3,
          },
        ],
        durationMs,
        startedAt,
        endedAt,
        dimensions: {
          flow: flowId,
          unit,
          tenant,
          cache: "none",
          duration_ms: durationMs,
          build_version: BUILD,
        },
      });
      i += 1;
      continue;
    }

    if (roll < 0.9) {
      const durationMs = 200 + Math.floor(rand() * 400);
      const endedAt = startedAt + durationMs;
      const cost = 0.008 + rand() * 0.02;
      out.push({
        id: `pw-ops-plan-${seq}`,
        flow: "my.plan",
        unit: "my",
        trigger: "http",
        plane: "user",
        tenant,
        principal,
        subjectId: principal,
        gates: ["member"],
        cache: "none",
        cost,
        promptVersion: 1,
        buildVersion: BUILD,
        input: { identifier, message: "Need a suggested assignee" },
        output: { replyQueued: true, template: "mention-reply" },
        effects: [
          {
            kind: "secret",
            resource: "OPENAI_KEY",
            timestamp: startedAt + 4,
            duration: 1,
            reversibility: "capability",
          },
          {
            kind: "ask",
            resource: "form-classify@1",
            timestamp: startedAt + 8,
            duration: Math.max(80, durationMs - 60),
            reversibility: "irreversible",
          },
          {
            kind: "send",
            resource: "mention-reply",
            timestamp: endedAt - 30,
            duration: 20 + Math.floor(rand() * 20),
            reversibility: "irreversible",
          },
        ],
        logs: [
          {
            level: "info",
            message: "prompt form-classify@1 answered",
            data: { via: "fast", cost },
            at: endedAt - 40,
          },
        ],
        durationMs,
        startedAt,
        endedAt,
        dimensions: {
          flow: "my.plan",
          unit: "my",
          tenant,
          prompt: "form-classify",
          cost,
          duration_ms: durationMs,
          build_version: BUILD,
        },
      });
      i += 1;
      continue;
    }

    if (roll < 0.96) {
      if (rand() < 0.55) {
        const durationMs = 30 + Math.floor(rand() * 80);
        const endedAt = startedAt + durationMs;
        out.push({
          id: `pw-ops-drafts-${seq}`,
          flow: "drafts.expire-drafts",
          unit: "drafts",
          trigger: "every",
          plane: "operator",
          tenant: null,
          principal: "clock_bot",
          gates: [],
          cache: "none",
          buildVersion: BUILD,
          output: { expired: 1 + Math.floor(rand() * 5) },
          effects: [
            {
              kind: "read",
              resource: "kv:drafts",
              timestamp: startedAt + 2,
              duration: 6,
              reversibility: "none",
            },
            {
              kind: "write",
              resource: "kv:drafts",
              timestamp: startedAt + 10,
              duration: 10,
              reversibility: "reversible",
            },
            {
              kind: "emit",
              resource: "draft-expired",
              timestamp: endedAt - 8,
              duration: 4,
              reversibility: "deferred",
            },
          ],
          logs: [
            {
              level: "info",
              message: "expire-drafts tick",
              data: { clock: "expire-drafts" },
              at: startedAt + 1,
            },
          ],
          durationMs,
          startedAt,
          endedAt,
          dimensions: {
            flow: "drafts.expire-drafts",
            unit: "drafts",
            plane: "operator",
            clock: "expire-drafts",
            duration_ms: durationMs,
            build_version: BUILD,
          },
        });
        i += 1;
        continue;
      }

      const durationMs = 40 + Math.floor(rand() * 80);
      const endedAt = startedAt + durationMs;
      out.push({
        id: `pw-ops-overdue-${seq}`,
        flow: "overdue.watch-overdue",
        unit: "overdue",
        trigger: "every",
        plane: "operator",
        tenant: null,
        principal: "clock_bot",
        gates: [],
        cache: "none",
        buildVersion: BUILD,
        output: { overdue: 1 + Math.floor(rand() * 3) },
        effects: [
          {
            kind: "read",
            resource: "sql:tasks",
            timestamp: startedAt + 4,
            duration: 16,
            reversibility: "none",
          },
          {
            kind: "send",
            resource: "task-overdue",
            timestamp: endedAt - 8,
            duration: 6,
            reversibility: "irreversible",
          },
        ],
        logs: [
          {
            level: "warn",
            message: "overdue watch tick",
            data: { clock: "watch-overdue" },
            at: startedAt + 1,
          },
        ],
        durationMs,
        startedAt,
        endedAt,
        dimensions: {
          flow: "overdue.watch-overdue",
          unit: "overdue",
          plane: "operator",
          clock: "watch-overdue",
          duration_ms: durationMs,
          build_version: BUILD,
        },
      });
      i += 1;
      continue;
    }

    const durationMs = 400 + Math.floor(rand() * 900);
    const endedAt = startedAt + durationMs;
    out.push({
      id: `pw-ops-cron-${seq}`,
      flow: "digest.daily",
      unit: "digest",
      trigger: "cron",
      plane: "operator",
      tenant: null,
      principal: "ops_bot",
      gates: [],
      cache: "none",
      replica: "primary",
      buildVersion: BUILD,
      effects: [
        {
          kind: "read",
          resource: "sql:tasks",
          timestamp: startedAt + 20,
          duration: 100 + Math.floor(rand() * 200),
          reversibility: "none",
        },
        {
          kind: "send",
          resource: "daily-digest",
          timestamp: endedAt - 20,
          duration: 8,
          reversibility: "irreversible",
        },
      ],
      logs: [
        {
          level: "info",
          message: "morning inbox + goal digest queued",
          data: { open: Math.floor(rand() * 6) },
          at: endedAt - 15,
        },
      ],
      durationMs,
      startedAt,
      endedAt,
      dimensions: {
        flow: "digest.daily",
        unit: "digest",
        plane: "operator",
        cache: "none",
        clock: "daily-digest",
        duration_ms: durationMs,
        build_version: BUILD,
      },
    });
    i += 1;
  }

  return out.slice(0, count);
}

/**
 * Build the primary seeded WideEvent (`tasks.create` success).
 *
 * @param now - Clock ms (defaults to `Date.now()`)
 */
export function createUiNextSeedRun(now: number = Date.now()): WideEvent {
  const runs = createUiNextSeedRuns(now);
  const primary = runs.find((r) => r.id === UI_NEXT_SEED_RUN_ID);
  if (!primary) {
    throw new Error("ui-next seed: primary tasks.create run missing");
  }
  return primary;
}
