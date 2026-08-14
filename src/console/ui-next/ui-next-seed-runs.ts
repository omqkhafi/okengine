/**
 * Featured + operational WideEvents for the keel Console seed.
 *
 * Featured chain: github.ingest → issues.create → notify.onIssue.
 * Ops traffic is deterministic (mulberry32) and stays older than the
 * featured cluster so Playwright-stable rows sit near the top.
 */

import type { WideEvent } from "../../runs/types.ts";

/** Stable run id for the successful `issues.create` WideEvent (Playwright). */
export const UI_NEXT_SEED_RUN_ID = "pw-run-issues-create";

/** Child notify run linked via `parentId` to {@link UI_NEXT_SEED_RUN_ID}. */
export const UI_NEXT_SEED_NOTIFY_RUN_ID = "pw-run-notify-on-issue";

/** Parent GitHub ingest run that `call`s into {@link UI_NEXT_SEED_RUN_ID}. */
export const UI_NEXT_SEED_INGEST_RUN_ID = "pw-run-github-ingest";

/** Failed sibling `issues.create` (`CycleClosed`). */
export const UI_NEXT_SEED_FAIL_RUN_ID = "pw-run-issues-create-fail";

/** Recent live `issues.list` poll. */
export const UI_NEXT_SEED_LIST_RUN_ID = "pw-run-issues-list";

/** Monday cycle rollover (cron / clock). */
export const UI_NEXT_SEED_CYCLES_RUN_ID = "pw-run-cycles-close";

/** Triage Intelligence with Vault secret + AI ask + channel send. */
export const UI_NEXT_SEED_TRIAGE_RUN_ID = "pw-run-triage-suggest";

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
const OPS_TEAMS = ["ENG", "DES", "SUP"] as const;
const OPS_TITLES = [
  "Pulse graph on selected trace",
  "Store grid range select",
  "RTL cell polish",
  "Replica lag banner",
  "Cycle digest email",
  "Dimension query presets",
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
 * fail / list / cycles / triage / drafts siblings).
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
  const cyclesStart = now - 3 * 60 * 60_000;
  const cyclesEnd = cyclesStart + 890;

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
      title: "Pulse graph on selected trace",
      teamKey: "ENG",
    },
    output: { identifier: "ENG-184", issueId: "iss_eng_184", status: "synced" },
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
        resource: "issues.create",
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
        message: "synced issue from pull request",
        data: { identifier: "ENG-184" },
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
    flow: "issues.create",
    unit: "issues",
    trigger: "http",
    plane: "user",
    tenant: "ws_keel",
    principal: "user_aria",
    subjectId: "user_aria",
    gates: ["member", "issue:write"],
    cache: "hit",
    replica: "primary",
    buildVersion: BUILD,
    input: {
      title: "Pulse graph on selected trace",
      teamKey: "ENG",
      priority: 2,
    },
    output: { id: "iss_eng_184", identifier: "ENG-184" },
    effects: [
      {
        kind: "read",
        resource: "sql:issues",
        timestamp: createStart + 3,
        duration: 9,
        reversibility: "none",
      },
      {
        kind: "write",
        resource: "sql:issues",
        timestamp: createStart + 14,
        duration: 18,
        reversibility: "reversible",
      },
      {
        kind: "emit",
        resource: "issue-created",
        timestamp: createStart + 36,
        duration: 5,
        reversibility: "deferred",
      },
    ],
    logs: [
      {
        level: "info",
        message: "issue create started",
        data: { teamKey: "ENG", title: "Pulse graph on selected trace" },
        at: createStart + 1,
      },
      {
        level: "info",
        message: "issue reserved",
        data: { identifier: "ENG-184" },
        at: createStart + 32,
      },
      {
        level: "debug",
        message: "emitted issue-created",
        at: createStart + 40,
      },
    ],
    durationMs: createEnd - createStart,
    startedAt: createStart,
    endedAt: createEnd,
    dimensions: {
      flow: "issues.create",
      unit: "issues",
      tenant: "ws_keel",
      cache: "hit",
      team_key: "ENG",
      identifier: "ENG-184",
      priority: 2,
      duration_ms: createEnd - createStart,
      build_version: BUILD,
    },
  };

  const notify: WideEvent = {
    id: UI_NEXT_SEED_NOTIFY_RUN_ID,
    parentId: UI_NEXT_SEED_RUN_ID,
    flow: "notify.onIssue",
    unit: "notify",
    trigger: "signal",
    plane: "user",
    tenant: "ws_keel",
    principal: "user_aria",
    subjectId: "user_aria",
    gates: [],
    cache: "none",
    buildVersion: BUILD,
    input: { signal: "issue-created", identifier: "ENG-184" },
    output: { identifier: "ENG-184", assigned: true, template: "issue-assigned" },
    effects: [
      {
        kind: "write",
        resource: "sql:issues",
        timestamp: notifyStart + 8,
        duration: 22,
        reversibility: "reversible",
      },
      {
        kind: "send",
        resource: "issue-assigned",
        timestamp: notifyStart + 40,
        duration: 78,
        reversibility: "irreversible",
      },
    ],
    logs: [
      {
        level: "info",
        message: "notify consumed issue-created",
        data: { identifier: "ENG-184" },
        at: notifyStart + 2,
      },
      {
        level: "info",
        message: "assignment email queued",
        data: { template: "issue-assigned", locale: "en" },
        at: notifyStart + 110,
      },
    ],
    durationMs: notifyEnd - notifyStart,
    startedAt: notifyStart,
    endedAt: notifyEnd,
    dimensions: {
      flow: "notify.onIssue",
      unit: "notify",
      tenant: "ws_keel",
      cache: "none",
      signal: "issue-created",
      duration_ms: notifyEnd - notifyStart,
      build_version: BUILD,
    },
  };

  const createFail: WideEvent = {
    id: UI_NEXT_SEED_FAIL_RUN_ID,
    flow: "issues.create",
    unit: "issues",
    trigger: "http",
    plane: "user",
    tenant: "ws_harbor",
    principal: "user_ben",
    subjectId: "user_ben",
    gates: ["member", "issue:write"],
    cache: "miss",
    replica: "replica",
    replicaLagMs: 180,
    buildVersion: BUILD,
    error: {
      code: "CycleClosed",
      message: "Cycle 24 is completed — issues cannot be added",
    },
    input: {
      title: "Late cycle 24 leftover",
      teamKey: "ENG",
      priority: 3,
    },
    effects: [
      {
        kind: "read",
        resource: "sql:issues",
        timestamp: failStart + 4,
        duration: 21,
        reversibility: "none",
      },
    ],
    logs: [
      {
        level: "warn",
        message: "cycle closed",
        data: { code: "CycleClosed", cycle: 24 },
        at: failStart + 26,
      },
    ],
    durationMs: failEnd - failStart,
    startedAt: failStart,
    endedAt: failEnd,
    dimensions: {
      flow: "issues.create",
      unit: "issues",
      tenant: "ws_harbor",
      cache: "miss",
      error_code: "CycleClosed",
      replica: "replica",
      replica_lag_ms: 180,
      team_key: "ENG",
      duration_ms: failEnd - failStart,
      build_version: BUILD,
    },
  };

  const list: WideEvent = {
    id: UI_NEXT_SEED_LIST_RUN_ID,
    flow: "issues.list",
    unit: "issues",
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
      issues: [
        { id: "iss_eng_184", identifier: "ENG-184" },
        { id: "iss_eng_185", identifier: "ENG-185" },
        { id: "iss_eng_186", identifier: "ENG-186" },
      ],
    },
    effects: [
      {
        kind: "read",
        resource: "sql:issues",
        timestamp: listStart + 2,
        duration: 8,
        reversibility: "none",
      },
    ],
    logs: [
      {
        level: "debug",
        message: "listed issues for principal",
        data: { count: 3 },
        at: listStart + 10,
      },
    ],
    durationMs: listEnd - listStart,
    startedAt: listStart,
    endedAt: listEnd,
    dimensions: {
      flow: "issues.list",
      unit: "issues",
      tenant: "ws_keel",
      cache: "hit",
      replica: "replica",
      duration_ms: listEnd - listStart,
      build_version: BUILD,
    },
  };

  const cycles: WideEvent = {
    id: UI_NEXT_SEED_CYCLES_RUN_ID,
    flow: "cycles.close",
    unit: "cycles",
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
    output: { closed: 24, rolled: 3, next: 25 },
    effects: [
      {
        kind: "read",
        resource: "sql:cycles",
        timestamp: cyclesStart + 20,
        duration: 210,
        reversibility: "none",
      },
      {
        kind: "write",
        resource: "sql:issues",
        timestamp: cyclesStart + 280,
        duration: 410,
        reversibility: "reversible",
      },
      {
        kind: "secret",
        resource: "SLACK_WEBHOOK",
        timestamp: cyclesStart + 700,
        duration: 1,
        reversibility: "capability",
      },
      {
        kind: "ask",
        resource: "cycle-summary@1",
        timestamp: cyclesStart + 710,
        duration: 80,
        reversibility: "irreversible",
      },
      {
        kind: "emit",
        resource: "cycle-closed",
        timestamp: cyclesStart + 800,
        duration: 12,
        reversibility: "deferred",
      },
      {
        kind: "send",
        resource: "cycle-digest",
        timestamp: cyclesStart + 820,
        duration: 40,
        reversibility: "irreversible",
      },
    ],
    logs: [
      {
        level: "info",
        message: "cycle rollover started",
        at: cyclesStart + 1,
      },
      {
        level: "info",
        message: "rolled open issues into next cycle",
        data: { closed: 24, rolled: 3 },
        at: cyclesEnd - 20,
      },
    ],
    durationMs: cyclesEnd - cyclesStart,
    startedAt: cyclesStart,
    endedAt: cyclesEnd,
    dimensions: {
      flow: "cycles.close",
      unit: "cycles",
      plane: "operator",
      cache: "none",
      clock: "close-cycles",
      duration_ms: cyclesEnd - cyclesStart,
      build_version: BUILD,
    },
  };

  const triageStart = now - 95_000;
  const triageEnd = triageStart + 420;
  const triage: WideEvent = {
    id: UI_NEXT_SEED_TRIAGE_RUN_ID,
    flow: "triage.suggest",
    unit: "triage",
    trigger: "http",
    plane: "user",
    tenant: "ws_keel",
    principal: "user_aria",
    subjectId: "user_aria",
    gates: ["member"],
    cache: "none",
    cost: 0.014,
    promptVersion: 3,
    buildVersion: BUILD,
    input: {
      identifier: "SUP-12",
      message: "Customer cannot sign in after claim rotate",
    },
    output: {
      assignee: "dia@keel.dev",
      labels: ["bug", "customer"],
      duplicates: ["ENG-189"],
      replyQueued: true,
      template: "mention-reply",
    },
    effects: [
      {
        kind: "read",
        resource: "sql:issues",
        timestamp: triageStart + 4,
        duration: 12,
        reversibility: "none",
      },
      {
        kind: "secret",
        resource: "OPENAI_KEY",
        timestamp: triageStart + 18,
        duration: 1,
        reversibility: "capability",
      },
      {
        kind: "ask",
        resource: "issue-triage@3",
        timestamp: triageStart + 22,
        duration: 340,
        reversibility: "irreversible",
      },
      {
        kind: "send",
        resource: "mention-reply",
        timestamp: triageStart + 370,
        duration: 40,
        reversibility: "irreversible",
      },
    ],
    logs: [
      {
        level: "info",
        message: "triage started",
        data: { identifier: "SUP-12" },
        at: triageStart + 2,
      },
      {
        level: "info",
        message: "prompt issue-triage@3 answered",
        data: { via: "smart", cost: 0.014 },
        at: triageStart + 360,
      },
      {
        level: "info",
        message: "mention-reply queued",
        data: { template: "mention-reply", locale: "en" },
        at: triageStart + 400,
      },
    ],
    durationMs: triageEnd - triageStart,
    startedAt: triageStart,
    endedAt: triageEnd,
    dimensions: {
      flow: "triage.suggest",
      unit: "triage",
      tenant: "ws_keel",
      cache: "none",
      prompt: "issue-triage",
      prompt_version: 3,
      cost: 0.014,
      duration_ms: triageEnd - triageStart,
      build_version: BUILD,
    },
  };

  const draftsStart = now - 12 * 60_000;
  const draftsEnd = draftsStart + 55;
  const drafts: WideEvent = {
    id: UI_NEXT_SEED_DRAFTS_RUN_ID,
    flow: "drafts.expire",
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
      flow: "drafts.expire",
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
    cycles,
    triage,
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
    const teamKey = OPS_TEAMS[Math.floor(rand() * OPS_TEAMS.length)]!;
    const title = OPS_TITLES[Math.floor(rand() * OPS_TITLES.length)]!;
    const seq = String(i).padStart(3, "0");
    const identifier = `${teamKey}-${100 + i}`;

    if (roll < 0.38) {
      const durationMs = 8 + Math.floor(rand() * 40);
      const endedAt = startedAt + durationMs;
      const cache = rand() < 0.7 ? "hit" : "miss";
      out.push({
        id: `pw-ops-list-${seq}`,
        flow: "issues.list",
        unit: "issues",
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
            resource: "sql:issues",
            timestamp: startedAt + 2,
            duration: Math.max(2, durationMs - 4),
            reversibility: "none",
          },
        ],
        logs: [
          {
            level: "debug",
            message: "listed issues for principal",
            data: { count: 1 + Math.floor(rand() * 8) },
            at: startedAt + 3,
          },
        ],
        durationMs,
        startedAt,
        endedAt,
        dimensions: {
          flow: "issues.list",
          unit: "issues",
          tenant,
          cache,
          duration_ms: durationMs,
          build_version: BUILD,
        },
      });
      i += 1;
      continue;
    }

    if (roll < 0.58) {
      const durationMs = 28 + Math.floor(rand() * 90);
      const endedAt = startedAt + durationMs;
      const createId = `pw-ops-create-${seq}`;
      const priority = 1 + Math.floor(rand() * 4);
      out.push({
        id: createId,
        flow: "issues.create",
        unit: "issues",
        trigger: "http",
        plane: "user",
        tenant,
        principal,
        subjectId: principal,
        gates: ["member", "issue:write"],
        cache: rand() < 0.55 ? "hit" : "miss",
        replica: "primary",
        buildVersion: BUILD,
        input: { title, teamKey, priority },
        output: { id: `iss_ops_${seq}`, identifier },
        effects: [
          {
            kind: "read",
            resource: "sql:issues",
            timestamp: startedAt + 2,
            duration: 6 + Math.floor(rand() * 12),
            reversibility: "none",
          },
          {
            kind: "write",
            resource: "sql:issues",
            timestamp: startedAt + 12,
            duration: 10 + Math.floor(rand() * 20),
            reversibility: "reversible",
          },
          {
            kind: "emit",
            resource: "issue-created",
            timestamp: endedAt - 8,
            duration: 3 + Math.floor(rand() * 6),
            reversibility: "deferred",
          },
        ],
        logs: [
          {
            level: "info",
            message: "issue create started",
            data: { teamKey, title },
            at: startedAt + 1,
          },
          {
            level: "info",
            message: "issue reserved",
            data: { identifier },
            at: endedAt - 10,
          },
        ],
        durationMs,
        startedAt,
        endedAt,
        dimensions: {
          flow: "issues.create",
          unit: "issues",
          tenant,
          cache: "hit",
          team_key: teamKey,
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
          flow: "notify.onIssue",
          unit: "notify",
          trigger: "signal",
          plane: "user",
          tenant,
          principal,
          subjectId: principal,
          gates: [],
          cache: "none",
          buildVersion: BUILD,
          input: { signal: "issue-created", identifier },
          output: { identifier, assigned: true },
          effects: [
            {
              kind: "write",
              resource: "sql:issues",
              timestamp: fStart + 6,
              duration: 12 + Math.floor(rand() * 20),
              reversibility: "reversible",
            },
            {
              kind: "send",
              resource: "issue-assigned",
              timestamp: fStart + 30,
              duration: 40 + Math.floor(rand() * 50),
              reversibility: "irreversible",
            },
          ],
          logs: [
            {
              level: "info",
              message: "assignment email queued",
              data: { template: "issue-assigned" },
              at: fStart + fDur - 8,
            },
          ],
          durationMs: fDur,
          startedAt: fStart,
          endedAt: fStart + fDur,
          dimensions: {
            flow: "notify.onIssue",
            unit: "notify",
            tenant,
            cache: "none",
            signal: "issue-created",
            duration_ms: fDur,
            build_version: BUILD,
          },
        });
        i += 1;
      }
      continue;
    }

    if (roll < 0.68) {
      const durationMs = 18 + Math.floor(rand() * 40);
      const endedAt = startedAt + durationMs;
      const duplicate = rand() < 0.35;
      out.push({
        id: `pw-ops-fail-${seq}`,
        flow: "issues.create",
        unit: "issues",
        trigger: "http",
        plane: "user",
        tenant,
        principal,
        subjectId: principal,
        gates: ["member", "issue:write"],
        cache: "miss",
        replica: "replica",
        replicaLagMs: 80 + Math.floor(rand() * 200),
        buildVersion: BUILD,
        error: duplicate
          ? { code: "Duplicate", message: `${identifier} is a duplicate of ENG-184` }
          : { code: "CycleClosed", message: `Cycle 24 is completed — cannot add ${identifier}` },
        input: { title, teamKey, priority: 3 },
        effects: [
          {
            kind: "read",
            resource: "sql:issues",
            timestamp: startedAt + 3,
            duration: Math.max(4, durationMs - 6),
            reversibility: "none",
          },
        ],
        logs: [
          {
            level: "warn",
            message: duplicate ? "duplicate issue" : "cycle closed",
            data: { code: duplicate ? "Duplicate" : "CycleClosed", teamKey },
            at: endedAt - 4,
          },
        ],
        durationMs,
        startedAt,
        endedAt,
        dimensions: {
          flow: "issues.create",
          unit: "issues",
          tenant,
          cache: "miss",
          error_code: duplicate ? "Duplicate" : "CycleClosed",
          team_key: teamKey,
          duration_ms: durationMs,
          build_version: BUILD,
        },
      });
      i += 1;
      continue;
    }

    if (roll < 0.78) {
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
        input: { repo: "keel/okengine", action: "opened", title, teamKey },
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
            resource: "issues.create",
            timestamp: startedAt + 8,
            duration: Math.max(10, durationMs - 20),
            reversibility: "portal",
          },
        ],
        logs: [
          {
            level: "info",
            message: "github webhook accepted",
            data: { teamKey },
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

    if (roll < 0.86) {
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
        gates: ["member", "issue:write"],
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

    if (roll < 0.92) {
      const durationMs = 200 + Math.floor(rand() * 400);
      const endedAt = startedAt + durationMs;
      const cost = 0.008 + rand() * 0.02;
      out.push({
        id: `pw-ops-triage-${seq}`,
        flow: "triage.suggest",
        unit: "triage",
        trigger: "http",
        plane: "user",
        tenant,
        principal,
        subjectId: principal,
        gates: ["member"],
        cache: "none",
        cost,
        promptVersion: 3,
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
            resource: "issue-triage@3",
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
            message: "prompt issue-triage@3 answered",
            data: { via: "smart", cost },
            at: endedAt - 40,
          },
        ],
        durationMs,
        startedAt,
        endedAt,
        dimensions: {
          flow: "triage.suggest",
          unit: "triage",
          tenant,
          prompt: "issue-triage",
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
          flow: "drafts.expire",
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
            flow: "drafts.expire",
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
        id: `pw-ops-sla-${seq}`,
        flow: "sla.watch",
        unit: "sla",
        trigger: "every",
        plane: "operator",
        tenant: null,
        principal: "clock_bot",
        gates: [],
        cache: "none",
        buildVersion: BUILD,
        output: { breaching: 1 + Math.floor(rand() * 3) },
        effects: [
          {
            kind: "read",
            resource: "sql:issues",
            timestamp: startedAt + 4,
            duration: 16,
            reversibility: "none",
          },
          {
            kind: "emit",
            resource: "sla-breaching",
            timestamp: endedAt - 12,
            duration: 5,
            reversibility: "deferred",
          },
          {
            kind: "send",
            resource: "sla-alert",
            timestamp: endedAt - 8,
            duration: 6,
            reversibility: "irreversible",
          },
        ],
        logs: [
          {
            level: "warn",
            message: "sla watch tick",
            data: { clock: "watch-sla" },
            at: startedAt + 1,
          },
        ],
        durationMs,
        startedAt,
        endedAt,
        dimensions: {
          flow: "sla.watch",
          unit: "sla",
          plane: "operator",
          clock: "watch-sla",
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
      flow: "cycles.close",
      unit: "cycles",
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
          resource: "sql:cycles",
          timestamp: startedAt + 20,
          duration: 100 + Math.floor(rand() * 200),
          reversibility: "none",
        },
        {
          kind: "write",
          resource: "sql:issues",
          timestamp: startedAt + 200,
          duration: 150 + Math.floor(rand() * 300),
          reversibility: "reversible",
        },
        {
          kind: "emit",
          resource: "cycle-closed",
          timestamp: endedAt - 20,
          duration: 8,
          reversibility: "deferred",
        },
      ],
      logs: [
        {
          level: "info",
          message: "rolled open issues into next cycle",
          data: { rolled: Math.floor(rand() * 6) },
          at: endedAt - 15,
        },
      ],
      durationMs,
      startedAt,
      endedAt,
      dimensions: {
        flow: "cycles.close",
        unit: "cycles",
        plane: "operator",
        cache: "none",
        clock: "close-cycles",
        duration_ms: durationMs,
        build_version: BUILD,
      },
    });
    i += 1;
  }

  return out.slice(0, count);
}

/**
 * Build the primary seeded WideEvent (`issues.create` success).
 *
 * @param now - Clock ms (defaults to `Date.now()`)
 */
export function createUiNextSeedRun(now: number = Date.now()): WideEvent {
  const runs = createUiNextSeedRuns(now);
  const primary = runs.find((r) => r.id === UI_NEXT_SEED_RUN_ID);
  if (!primary) {
    throw new Error("ui-next seed: primary issues.create run missing");
  }
  return primary;
}
