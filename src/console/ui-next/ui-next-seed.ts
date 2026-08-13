/**
 * Shared ui-next seed — same Manifest + WideEvents used by Playwright and
 * `bun run dev:console-next:seed` so manual browser exploration matches CI.
 *
 * Lives beside the Vite kernel plugin (root `tsc` include) — not under
 * `src/console/ui/**`, which root typecheck excludes as the legacy SPA tree.
 *
 * Seed story (skyport): a featured payments→create→fulfill chain, plus ~70
 * operational traces so Traces looks like a live system (50–100 band).
 */

import type { Manifest } from "../../manifest/types.ts";
import type { RunsStore, WideEvent } from "../../runs/types.ts";
import { FLOWS_TEST_MANIFEST } from "../ui/flows/fixture.ts";
import { defineTable } from "../../elements/store.ts";
import { classify } from "../../elements/store/classify.ts";
import type { SqlStoreHandle } from "../../elements/store/sql-session.ts";
import type {
  FilesStoreFxHandle,
  KvStoreFxHandle,
  StoreRuntime,
  VectorIndexStoreFxHandle,
} from "../../elements/store/runtime.ts";

/** Stable run id for the successful `bookings.create` WideEvent (Playwright). */
export const UI_NEXT_SEED_RUN_ID = "pw-run-bookings-create";

/** Child fulfillment run linked via `parentId` to {@link UI_NEXT_SEED_RUN_ID}. */
export const UI_NEXT_SEED_FULFILL_RUN_ID = "pw-run-fulfillment-on-order";

/** Parent payments run that `call`s into {@link UI_NEXT_SEED_RUN_ID}. */
export const UI_NEXT_SEED_PAYMENTS_RUN_ID = "pw-run-payments-charge";

/** Failed sibling `bookings.create` (`FlightFull`). */
export const UI_NEXT_SEED_FAIL_RUN_ID = "pw-run-bookings-create-fail";

/** Recent live `bookings.mine` poll. */
export const UI_NEXT_SEED_MINE_RUN_ID = "pw-run-bookings-mine";

/** Nightly ops reconcile (cron / clock). */
export const UI_NEXT_SEED_OPS_RUN_ID = "pw-run-ops-nightly";

/** Support triage with Vault secret + AI ask + channel send. */
export const UI_NEXT_SEED_SUPPORT_RUN_ID = "pw-run-support-triage";

/** Holds expiry driven by a named Clock (`every: 10m`). */
export const UI_NEXT_SEED_HOLDS_RUN_ID = "pw-run-holds-expire";

/**
 * Manifest seeded into the Console — all eight elements declared so the
 * Flows graph + Traces ledger look like a real skyport system.
 *
 * | Element | Seed surface                                      |
 * | ------- | ------------------------------------------------- |
 * | flow    | bookings · fulfillment · payments · support · …   |
 * | signal  | `order-placed` · `hold-expired`                   |
 * | store   | `sql:bookings/shipments` · `kv:holds` · `files:uploads` · `index:docs` |
 * | clock   | `nightly` cron · `expire-holds` every             |
 * | gate    | member · booking:create · bookings.write          |
 * | vault   | STRIPE_KEY · OPENAI_KEY                           |
 * | channel | booking-confirmed · support-reply                 |
 * | ai      | ticket-triage prompt · support agent              |
 */
export const UI_NEXT_SEEDED_MANIFEST: Manifest = {
  ...FLOWS_TEST_MANIFEST,
  app: "skyport",
  flows: {
    ...FLOWS_TEST_MANIFEST.flows,
    "bookings.create": {
      ...FLOWS_TEST_MANIFEST.flows!["bookings.create"]!,
      gates: ["member", "booking:create", "bookings.write"],
    },
    "bookings.mine": {
      ...FLOWS_TEST_MANIFEST.flows!["bookings.mine"]!,
      gates: ["member"],
      plane: "user",
    },
    "payments.chargeBooking": {
      ...FLOWS_TEST_MANIFEST.flows!["payments.chargeBooking"]!,
      plane: "user",
      gates: ["member"],
      effects: {
        secrets: ["STRIPE_KEY"],
        calls: ["bookings.create"],
      },
    },
    "support.triage": {
      trigger: { http: { method: "POST", path: "/support/triage" } },
      plane: "user",
      gates: ["member"],
      effects: {
        reads: ["sql:bookings"],
        secrets: ["OPENAI_KEY"],
        asks: ["ticket-triage"],
        sends: ["support-reply"],
      },
      source: "src/flows/support/index.ts:12",
    },
    "holds.expire": {
      trigger: { every: "10m" },
      plane: "operator",
      effects: {
        reads: ["kv:holds"],
        writes: ["kv:holds"],
        emits: ["hold-expired"],
      },
      source: "src/flows/holds/index.ts:6",
    },
    "docs.index": {
      trigger: { signal: "order-placed" },
      plane: "operator",
      effects: {
        reads: ["sql:bookings"],
        writes: ["index:docs"],
      },
      source: "src/flows/docs/index.ts:4",
    },
    "uploads.attach": {
      trigger: { http: { method: "POST", path: "/uploads/attach" } },
      plane: "user",
      gates: ["member"],
      effects: {
        reads: ["sql:bookings"],
        writes: ["files:uploads"],
      },
      source: "src/flows/uploads/index.ts:9",
    },
    "ops.nightlyReconcile": {
      trigger: { cron: "0 3 * * *" },
      plane: "operator",
      effects: {
        reads: ["sql:bookings"],
        writes: ["sql:bookings"],
      },
      source: "src/flows/ops/index.ts:8",
    },
  },
  signals: {
    "order-placed": {
      delivery: "once",
      retries: 5,
      deadLetter: true,
      description: "Booking created — wake fulfillment",
    },
    "hold-expired": {
      delivery: "broadcast",
      retries: 3,
      deadLetter: true,
      description: "Seat hold TTL elapsed",
    },
  },
  stores: {
    db: {
      facet: "sql",
      description: "Primary skyport SQL",
      tables: {
        bookings: {
          columns: {
            id: { type: "text", primaryKey: true },
            flight_id: { type: "text" },
            seats: { type: "integer" },
            email: {
              type: "text",
              pii: true,
              description: "Passenger contact (masked by default)",
            },
            note: {
              type: "text",
              description: "Operator note (mixed RTL/LTR sample)",
            },
          },
        },
        shipments: {
          columns: {
            id: { type: "text", primaryKey: true },
            booking_id: { type: "text" },
          },
        },
      },
    },
    cache: {
      facet: "kv",
      description: "Ephemeral holds",
      namespaces: ["holds"],
    },
    uploads: {
      facet: "files",
      description: "Passenger uploads (tickets, IDs)",
      buckets: ["uploads"],
    },
    docs: {
      facet: "index",
      description: "Semantic booking docs",
      indexes: ["docs"],
    },
  },
  clocks: {
    nightly: {
      cron: "0 3 * * *",
      timezone: "UTC",
      description: "Nightly booking reconcile",
    },
    "expire-holds": {
      every: "10m",
      timezone: "UTC",
      overridable: true,
      description: "Expire unpaid seat holds",
    },
  },
  gates: {
    member: {
      kind: "policy",
      description: "Signed-in member",
    },
    "booking:create": {
      kind: "policy",
      description: "May create bookings",
      scopes: ["booking:create"],
    },
    "bookings.write": {
      kind: "rate",
      strategy: "sliding-window-counter",
      max: 60,
      per: "1m",
      keyBy: "user",
      description: "Booking write throttle",
    },
  },
  vault: {
    STRIPE_KEY: { description: "Payments key", rotate: "90d" },
    OPENAI_KEY: { description: "AI provider key", rotate: "90d" },
  },
  channels: {
    "booking-confirmed": {
      medium: "email",
      locales: ["en"],
      description: "Booking confirmation",
    },
    "support-reply": {
      medium: "email",
      locales: ["en", "ar"],
      description: "Support triage reply",
    },
  },
  ai: {
    models: {
      smart: { provider: "openai", tier: "smart", model: "gpt-4.1" },
      fast: { provider: "openai", tier: "fast", model: "gpt-4.1-mini" },
    },
    prompts: {
      "ticket-triage": {
        version: 3,
        model: "smart",
        via: ["smart", "fast"],
        timeout: "30s",
        budget: { maxCostPerCall: 0.02 },
        evals: "./evals/triage.jsonl",
      },
    },
    agents: {
      support: {
        tools: ["bookings.mine", "bookings.create"],
        maxSteps: 6,
        model: "smart",
        budget: { maxCostPerRun: 0.25 },
      },
    },
  },
};

/**
 * Build the seeded WideEvent chain (payments → create → fulfill, plus
 * fail / mine / ops siblings).
 *
 * @param now - Clock ms (defaults to `Date.now()`)
 */
export function createUiNextSeedRuns(now: number = Date.now()): readonly WideEvent[] {
  const createStart = now - 42_000;
  const createEnd = createStart + 48;
  const fulfillStart = createEnd + 120;
  const fulfillEnd = fulfillStart + 132;
  const paymentsStart = createStart - 18;
  const paymentsEnd = createEnd + 6;
  const failStart = now - 6 * 60_000;
  const failEnd = failStart + 31;
  const mineStart = now - 8_000;
  const mineEnd = mineStart + 14;
  const opsStart = now - 3 * 60 * 60_000;
  const opsEnd = opsStart + 890;

  const payments: WideEvent = {
    id: UI_NEXT_SEED_PAYMENTS_RUN_ID,
    flow: "payments.chargeBooking",
    unit: "payments",
    trigger: "http",
    plane: "user",
    tenant: "org_skyport",
    principal: "user_aria",
    subjectId: "user_aria",
    gates: ["member"],
    cache: "miss",
    replica: "primary",
    buildVersion: "0.11.2",
    input: { bookingId: "bk_8f2a", amountCents: 42_900, currency: "USD" },
    output: { intentId: "pi_3Px9k2", bookingId: "bk_8f2a", status: "confirmed" },
    effects: [
      {
        kind: "secret",
        resource: "STRIPE_KEY",
        timestamp: paymentsStart + 2,
        duration: 1,
        reversibility: "capability",
      },
      {
        kind: "call",
        resource: "bookings.create",
        timestamp: paymentsStart + 8,
        duration: createEnd - createStart,
        reversibility: "portal",
      },
    ],
    logs: [
      {
        level: "info",
        message: "charging card for booking",
        data: { bookingId: "bk_8f2a", amountCents: 42_900 },
        at: paymentsStart + 1,
      },
      {
        level: "info",
        message: "stripe intent confirmed",
        data: { intentId: "pi_3Px9k2" },
        at: paymentsEnd - 4,
      },
    ],
    durationMs: paymentsEnd - paymentsStart,
    startedAt: paymentsStart,
    endedAt: paymentsEnd,
    dimensions: {
      flow: "payments.chargeBooking",
      unit: "payments",
      tenant: "org_skyport",
      cache: "miss",
      duration_ms: paymentsEnd - paymentsStart,
      build_version: "0.11.2",
    },
  };

  const createOk: WideEvent = {
    id: UI_NEXT_SEED_RUN_ID,
    parentId: UI_NEXT_SEED_PAYMENTS_RUN_ID,
    flow: "bookings.create",
    unit: "bookings",
    trigger: "http",
    plane: "user",
    tenant: "org_skyport",
    principal: "user_aria",
    subjectId: "user_aria",
    gates: ["member", "booking:create"],
    cache: "hit",
    replica: "primary",
    buildVersion: "0.11.2",
    input: {
      flightId: "SK-441",
      seats: 2,
      cabin: "economy",
    },
    output: { id: "bk_8f2a" },
    effects: [
      {
        kind: "read",
        resource: "sql:bookings",
        timestamp: createStart + 3,
        duration: 9,
        reversibility: "none",
      },
      {
        kind: "write",
        resource: "sql:bookings",
        timestamp: createStart + 14,
        duration: 18,
        reversibility: "reversible",
      },
      {
        kind: "emit",
        resource: "order-placed",
        timestamp: createStart + 36,
        duration: 5,
        reversibility: "deferred",
      },
    ],
    logs: [
      {
        level: "info",
        message: "booking started",
        data: { flightId: "SK-441", seats: 2 },
        at: createStart + 1,
      },
      {
        level: "info",
        message: "seats reserved",
        data: { bookingId: "bk_8f2a" },
        at: createStart + 32,
      },
      {
        level: "debug",
        message: "emitted order-placed",
        at: createStart + 40,
      },
    ],
    durationMs: createEnd - createStart,
    startedAt: createStart,
    endedAt: createEnd,
    dimensions: {
      flow: "bookings.create",
      unit: "bookings",
      tenant: "org_skyport",
      cache: "hit",
      flight_id: "SK-441",
      seats: 2,
      cabin: "economy",
      duration_ms: createEnd - createStart,
      build_version: "0.11.2",
    },
  };

  const fulfill: WideEvent = {
    id: UI_NEXT_SEED_FULFILL_RUN_ID,
    parentId: UI_NEXT_SEED_RUN_ID,
    flow: "fulfillment.onOrder",
    unit: "fulfillment",
    trigger: "signal",
    plane: "user",
    tenant: "org_skyport",
    principal: "user_aria",
    subjectId: "user_aria",
    gates: [],
    cache: "none",
    buildVersion: "0.11.2",
    input: { signal: "order-placed", bookingId: "bk_8f2a" },
    output: { bookingId: "bk_8f2a", shipped: true, template: "booking-confirmed" },
    effects: [
      {
        kind: "write",
        resource: "sql:shipments",
        timestamp: fulfillStart + 8,
        duration: 22,
        reversibility: "reversible",
      },
      {
        kind: "send",
        resource: "booking-confirmed",
        timestamp: fulfillStart + 40,
        duration: 78,
        reversibility: "irreversible",
      },
    ],
    logs: [
      {
        level: "info",
        message: "fulfillment consumed order-placed",
        data: { bookingId: "bk_8f2a" },
        at: fulfillStart + 2,
      },
      {
        level: "info",
        message: "confirmation email queued",
        data: { template: "booking-confirmed", locale: "en" },
        at: fulfillStart + 110,
      },
    ],
    durationMs: fulfillEnd - fulfillStart,
    startedAt: fulfillStart,
    endedAt: fulfillEnd,
    dimensions: {
      flow: "fulfillment.onOrder",
      unit: "fulfillment",
      tenant: "org_skyport",
      cache: "none",
      signal: "order-placed",
      duration_ms: fulfillEnd - fulfillStart,
      build_version: "0.11.2",
    },
  };

  const createFail: WideEvent = {
    id: UI_NEXT_SEED_FAIL_RUN_ID,
    flow: "bookings.create",
    unit: "bookings",
    trigger: "http",
    plane: "user",
    tenant: "org_harbor",
    principal: "user_ben",
    subjectId: "user_ben",
    gates: ["member", "booking:create"],
    cache: "miss",
    replica: "replica",
    replicaLagMs: 180,
    buildVersion: "0.11.2",
    error: {
      code: "FlightFull",
      message: "No seats left on SK-902 in economy",
    },
    input: {
      flightId: "SK-902",
      seats: 4,
      cabin: "economy",
    },
    effects: [
      {
        kind: "read",
        resource: "sql:bookings",
        timestamp: failStart + 4,
        duration: 21,
        reversibility: "none",
      },
    ],
    logs: [
      {
        level: "warn",
        message: "flight full",
        data: { code: "FlightFull", flightId: "SK-902" },
        at: failStart + 26,
      },
    ],
    durationMs: failEnd - failStart,
    startedAt: failStart,
    endedAt: failEnd,
    dimensions: {
      flow: "bookings.create",
      unit: "bookings",
      tenant: "org_harbor",
      cache: "miss",
      error_code: "FlightFull",
      replica: "replica",
      replica_lag_ms: 180,
      flight_id: "SK-902",
      duration_ms: failEnd - failStart,
      build_version: "0.11.2",
    },
  };

  const mine: WideEvent = {
    id: UI_NEXT_SEED_MINE_RUN_ID,
    flow: "bookings.mine",
    unit: "bookings",
    trigger: "http",
    plane: "user",
    tenant: "org_skyport",
    principal: "user_aria",
    subjectId: "user_aria",
    gates: ["member"],
    cache: "hit",
    replica: "replica",
    replicaLagMs: 12,
    buildVersion: "0.11.2",
    output: {
      count: 3,
      bookings: [
        { id: "bk_8f2a", flightId: "SK-441", seats: 2 },
        { id: "bk_7c1e", flightId: "SK-118", seats: 1 },
        { id: "bk_3aa0", flightId: "SK-902", seats: 2 },
      ],
    },
    effects: [
      {
        kind: "read",
        resource: "sql:bookings",
        timestamp: mineStart + 2,
        duration: 8,
        reversibility: "none",
      },
    ],
    logs: [
      {
        level: "debug",
        message: "listed bookings for principal",
        data: { count: 3 },
        at: mineStart + 10,
      },
    ],
    durationMs: mineEnd - mineStart,
    startedAt: mineStart,
    endedAt: mineEnd,
    dimensions: {
      flow: "bookings.mine",
      unit: "bookings",
      tenant: "org_skyport",
      cache: "hit",
      replica: "replica",
      duration_ms: mineEnd - mineStart,
      build_version: "0.11.2",
    },
  };

  const ops: WideEvent = {
    id: UI_NEXT_SEED_OPS_RUN_ID,
    flow: "ops.nightlyReconcile",
    unit: "ops",
    trigger: "cron",
    plane: "operator",
    tenant: null,
    principal: "ops_bot",
    gates: [],
    cache: "none",
    replica: "primary",
    buildVersion: "0.11.2",
    output: { scanned: 1284, fixed: 3 },
    effects: [
      {
        kind: "read",
        resource: "sql:bookings",
        timestamp: opsStart + 20,
        duration: 210,
        reversibility: "none",
      },
      {
        kind: "write",
        resource: "sql:bookings",
        timestamp: opsStart + 280,
        duration: 410,
        reversibility: "reversible",
      },
    ],
    logs: [
      {
        level: "info",
        message: "nightly reconcile started",
        at: opsStart + 1,
      },
      {
        level: "info",
        message: "reconciled open bookings",
        data: { scanned: 1284, fixed: 3 },
        at: opsEnd - 20,
      },
    ],
    durationMs: opsEnd - opsStart,
    startedAt: opsStart,
    endedAt: opsEnd,
    dimensions: {
      flow: "ops.nightlyReconcile",
      unit: "ops",
      plane: "operator",
      cache: "none",
      clock: "nightly",
      duration_ms: opsEnd - opsStart,
      build_version: "0.11.2",
    },
  };

  const supportStart = now - 95_000;
  const supportEnd = supportStart + 420;
  const support: WideEvent = {
    id: UI_NEXT_SEED_SUPPORT_RUN_ID,
    flow: "support.triage",
    unit: "support",
    trigger: "http",
    plane: "user",
    tenant: "org_skyport",
    principal: "user_aria",
    subjectId: "user_aria",
    gates: ["member"],
    cache: "none",
    cost: 0.014,
    promptVersion: 3,
    buildVersion: "0.11.2",
    input: {
      bookingId: "bk_8f2a",
      message: "Can I change my seats to window?",
    },
    output: {
      category: "seat_change",
      replyQueued: true,
      template: "support-reply",
    },
    effects: [
      {
        kind: "read",
        resource: "sql:bookings",
        timestamp: supportStart + 4,
        duration: 12,
        reversibility: "none",
      },
      {
        kind: "secret",
        resource: "OPENAI_KEY",
        timestamp: supportStart + 18,
        duration: 1,
        reversibility: "capability",
      },
      {
        kind: "ask",
        resource: "ticket-triage@3",
        timestamp: supportStart + 22,
        duration: 340,
        reversibility: "irreversible",
      },
      {
        kind: "send",
        resource: "support-reply",
        timestamp: supportStart + 370,
        duration: 40,
        reversibility: "irreversible",
      },
    ],
    logs: [
      {
        level: "info",
        message: "triage started",
        data: { bookingId: "bk_8f2a" },
        at: supportStart + 2,
      },
      {
        level: "info",
        message: "prompt ticket-triage@3 answered",
        data: { via: "smart", cost: 0.014 },
        at: supportStart + 360,
      },
      {
        level: "info",
        message: "support-reply queued",
        data: { template: "support-reply", locale: "en" },
        at: supportStart + 400,
      },
    ],
    durationMs: supportEnd - supportStart,
    startedAt: supportStart,
    endedAt: supportEnd,
    dimensions: {
      flow: "support.triage",
      unit: "support",
      tenant: "org_skyport",
      cache: "none",
      prompt: "ticket-triage",
      prompt_version: 3,
      cost: 0.014,
      duration_ms: supportEnd - supportStart,
      build_version: "0.11.2",
    },
  };

  const holdsStart = now - 12 * 60_000;
  const holdsEnd = holdsStart + 55;
  const holds: WideEvent = {
    id: UI_NEXT_SEED_HOLDS_RUN_ID,
    flow: "holds.expire",
    unit: "holds",
    trigger: "every",
    plane: "operator",
    tenant: null,
    principal: "clock_bot",
    gates: [],
    cache: "none",
    buildVersion: "0.11.2",
    output: { expired: 4 },
    effects: [
      {
        kind: "read",
        resource: "kv:holds",
        timestamp: holdsStart + 3,
        duration: 8,
        reversibility: "none",
      },
      {
        kind: "write",
        resource: "kv:holds",
        timestamp: holdsStart + 14,
        duration: 18,
        reversibility: "reversible",
      },
      {
        kind: "emit",
        resource: "hold-expired",
        timestamp: holdsStart + 38,
        duration: 6,
        reversibility: "deferred",
      },
    ],
    logs: [
      {
        level: "info",
        message: "expire-holds tick",
        data: { clock: "expire-holds", expired: 4 },
        at: holdsStart + 1,
      },
    ],
    durationMs: holdsEnd - holdsStart,
    startedAt: holdsStart,
    endedAt: holdsEnd,
    dimensions: {
      flow: "holds.expire",
      unit: "holds",
      plane: "operator",
      cache: "none",
      clock: "expire-holds",
      duration_ms: holdsEnd - holdsStart,
      build_version: "0.11.2",
    },
  };

  // Append order does not matter for GET /console/runs (sorted by startedAt).
  return [
    payments,
    createOk,
    fulfill,
    createFail,
    mine,
    ops,
    support,
    holds,
    ...createUiNextOperationRuns(now, UI_NEXT_SEED_OPERATION_COUNT),
  ];
}

/**
 * How many extra operational WideEvents to generate beyond the featured story.
 * Featured (8) + operations (72) = 80 traces — inside the 50–100 band and under
 * the Traces pane's 100-row cap.
 */
export const UI_NEXT_SEED_OPERATION_COUNT = 72;

/** Featured story run count (all eight elements exercised). */
export const UI_NEXT_SEED_FEATURED_COUNT = 8;

/**
 * Total seeded traces ({@link UI_NEXT_SEED_FEATURED_COUNT} + operations).
 */
export const UI_NEXT_SEED_TOTAL_COUNT = UI_NEXT_SEED_FEATURED_COUNT + UI_NEXT_SEED_OPERATION_COUNT;

const OPS_TENANTS = ["org_skyport", "org_harbor", "org_delta", "org_nova"] as const;
const OPS_USERS = ["user_aria", "user_ben", "user_cai", "user_dia", "user_eli"] as const;
const OPS_FLIGHTS = ["SK-101", "SK-220", "SK-441", "SK-512", "SK-902", "SK-118"] as const;

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
 * Build background operational traffic so Traces looks like a live system.
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
  // Keep ops traffic below the featured cluster (featured mine is now-8s).
  const newestOpsOffsetMs = 90_000;
  const oldestOpsOffsetMs = 6 * 60 * 60_000;

  let i = 0;
  while (out.length < count) {
    const roll = rand();
    const age = newestOpsOffsetMs + Math.floor(rand() * (oldestOpsOffsetMs - newestOpsOffsetMs));
    const startedAt = now - age;
    const tenant = OPS_TENANTS[Math.floor(rand() * OPS_TENANTS.length)]!;
    const principal = OPS_USERS[Math.floor(rand() * OPS_USERS.length)]!;
    const flightId = OPS_FLIGHTS[Math.floor(rand() * OPS_FLIGHTS.length)]!;
    const seq = String(i).padStart(3, "0");

    if (roll < 0.38) {
      // bookings.mine — fast reads
      const durationMs = 8 + Math.floor(rand() * 40);
      const endedAt = startedAt + durationMs;
      const cache = rand() < 0.7 ? "hit" : "miss";
      out.push({
        id: `pw-ops-mine-${seq}`,
        flow: "bookings.mine",
        unit: "bookings",
        trigger: "http",
        plane: "user",
        tenant,
        principal,
        subjectId: principal,
        gates: ["member"],
        cache,
        replica: cache === "hit" ? "replica" : "primary",
        replicaLagMs: cache === "hit" ? 8 + Math.floor(rand() * 40) : undefined,
        buildVersion: "0.11.2",
        effects: [
          {
            kind: "read",
            resource: "sql:bookings",
            timestamp: startedAt + 2,
            duration: Math.max(2, durationMs - 4),
            reversibility: "none",
          },
        ],
        logs: [
          {
            level: "debug",
            message: "listed bookings for principal",
            data: { count: 1 + Math.floor(rand() * 8) },
            at: startedAt + 3,
          },
        ],
        durationMs,
        startedAt,
        endedAt,
        dimensions: {
          flow: "bookings.mine",
          unit: "bookings",
          tenant,
          cache,
          duration_ms: durationMs,
          build_version: "0.11.2",
        },
      });
      i += 1;
      continue;
    }

    if (roll < 0.58) {
      // bookings.create success (+ optional fulfillment child)
      const durationMs = 28 + Math.floor(rand() * 90);
      const endedAt = startedAt + durationMs;
      const createId = `pw-ops-create-${seq}`;
      const seats = 1 + Math.floor(rand() * 4);
      const cabin = rand() < 0.25 ? "business" : "economy";
      out.push({
        id: createId,
        flow: "bookings.create",
        unit: "bookings",
        trigger: "http",
        plane: "user",
        tenant,
        principal,
        subjectId: principal,
        gates: ["member", "booking:create"],
        cache: rand() < 0.55 ? "hit" : "miss",
        replica: "primary",
        buildVersion: "0.11.2",
        input: { flightId, seats, cabin },
        output: { id: `bk_ops_${seq}` },
        effects: [
          {
            kind: "read",
            resource: "sql:bookings",
            timestamp: startedAt + 2,
            duration: 6 + Math.floor(rand() * 12),
            reversibility: "none",
          },
          {
            kind: "write",
            resource: "sql:bookings",
            timestamp: startedAt + 12,
            duration: 10 + Math.floor(rand() * 20),
            reversibility: "reversible",
          },
          {
            kind: "emit",
            resource: "order-placed",
            timestamp: endedAt - 8,
            duration: 3 + Math.floor(rand() * 6),
            reversibility: "deferred",
          },
        ],
        logs: [
          {
            level: "info",
            message: "booking started",
            data: { flightId, seats },
            at: startedAt + 1,
          },
          {
            level: "info",
            message: "seats reserved",
            data: { bookingId: `bk_ops_${seq}` },
            at: endedAt - 10,
          },
        ],
        durationMs,
        startedAt,
        endedAt,
        dimensions: {
          flow: "bookings.create",
          unit: "bookings",
          tenant,
          cache: "hit",
          flight_id: flightId,
          seats,
          cabin,
          duration_ms: durationMs,
          build_version: "0.11.2",
        },
      });
      i += 1;

      if (out.length < count && rand() < 0.65) {
        const fDur = 60 + Math.floor(rand() * 120);
        const fStart = endedAt + 40 + Math.floor(rand() * 400);
        out.push({
          id: `pw-ops-fulfill-${seq}`,
          parentId: createId,
          flow: "fulfillment.onOrder",
          unit: "fulfillment",
          trigger: "signal",
          plane: "user",
          tenant,
          principal,
          subjectId: principal,
          gates: [],
          cache: "none",
          buildVersion: "0.11.2",
          input: { signal: "order-placed", bookingId: `bk_ops_${seq}` },
          output: { bookingId: `bk_ops_${seq}`, shipped: true },
          effects: [
            {
              kind: "write",
              resource: "sql:shipments",
              timestamp: fStart + 6,
              duration: 12 + Math.floor(rand() * 20),
              reversibility: "reversible",
            },
            {
              kind: "send",
              resource: "booking-confirmed",
              timestamp: fStart + 30,
              duration: 40 + Math.floor(rand() * 50),
              reversibility: "irreversible",
            },
          ],
          logs: [
            {
              level: "info",
              message: "confirmation email queued",
              data: { template: "booking-confirmed" },
              at: fStart + fDur - 8,
            },
          ],
          durationMs: fDur,
          startedAt: fStart,
          endedAt: fStart + fDur,
          dimensions: {
            flow: "fulfillment.onOrder",
            unit: "fulfillment",
            tenant,
            cache: "none",
            signal: "order-placed",
            duration_ms: fDur,
            build_version: "0.11.2",
          },
        });
        i += 1;
      }
      continue;
    }

    if (roll < 0.68) {
      // bookings.create FlightFull
      const durationMs = 18 + Math.floor(rand() * 40);
      const endedAt = startedAt + durationMs;
      out.push({
        id: `pw-ops-fail-${seq}`,
        flow: "bookings.create",
        unit: "bookings",
        trigger: "http",
        plane: "user",
        tenant,
        principal,
        subjectId: principal,
        gates: ["member", "booking:create"],
        cache: "miss",
        replica: "replica",
        replicaLagMs: 80 + Math.floor(rand() * 200),
        buildVersion: "0.11.2",
        error: {
          code: "FlightFull",
          message: `No seats left on ${flightId}`,
        },
        input: { flightId, seats: 1 + Math.floor(rand() * 5), cabin: "economy" },
        effects: [
          {
            kind: "read",
            resource: "sql:bookings",
            timestamp: startedAt + 3,
            duration: Math.max(4, durationMs - 6),
            reversibility: "none",
          },
        ],
        logs: [
          {
            level: "warn",
            message: "flight full",
            data: { code: "FlightFull", flightId },
            at: endedAt - 4,
          },
        ],
        durationMs,
        startedAt,
        endedAt,
        dimensions: {
          flow: "bookings.create",
          unit: "bookings",
          tenant,
          cache: "miss",
          error_code: "FlightFull",
          flight_id: flightId,
          duration_ms: durationMs,
          build_version: "0.11.2",
        },
      });
      i += 1;
      continue;
    }

    if (roll < 0.9) {
      // payments.chargeBooking
      const durationMs = 40 + Math.floor(rand() * 160);
      const endedAt = startedAt + durationMs;
      const amountCents = 12_000 + Math.floor(rand() * 80_000);
      out.push({
        id: `pw-ops-pay-${seq}`,
        flow: "payments.chargeBooking",
        unit: "payments",
        trigger: "http",
        plane: "user",
        tenant,
        principal,
        subjectId: principal,
        gates: ["member"],
        cache: "miss",
        replica: "primary",
        buildVersion: "0.11.2",
        input: {
          bookingId: `bk_ops_${seq}`,
          amountCents,
          currency: "USD",
        },
        output: {
          intentId: `pi_ops_${seq}`,
          bookingId: `bk_ops_${seq}`,
          status: "confirmed",
        },
        effects: [
          {
            kind: "secret",
            resource: "STRIPE_KEY",
            timestamp: startedAt + 2,
            duration: 1,
            reversibility: "capability",
          },
          {
            kind: "call",
            resource: "bookings.create",
            timestamp: startedAt + 8,
            duration: Math.max(10, durationMs - 20),
            reversibility: "portal",
          },
        ],
        logs: [
          {
            level: "info",
            message: "charging card for booking",
            data: { amountCents },
            at: startedAt + 1,
          },
        ],
        durationMs,
        startedAt,
        endedAt,
        dimensions: {
          flow: "payments.chargeBooking",
          unit: "payments",
          tenant,
          cache: "miss",
          duration_ms: durationMs,
          build_version: "0.11.2",
        },
      });
      i += 1;
      continue;
    }

    if (roll < 0.96) {
      // support.triage — vault + ai ask + channel
      const durationMs = 200 + Math.floor(rand() * 400);
      const endedAt = startedAt + durationMs;
      const cost = 0.008 + rand() * 0.02;
      out.push({
        id: `pw-ops-support-${seq}`,
        flow: "support.triage",
        unit: "support",
        trigger: "http",
        plane: "user",
        tenant,
        principal,
        subjectId: principal,
        gates: ["member"],
        cache: "none",
        cost,
        promptVersion: 3,
        buildVersion: "0.11.2",
        input: {
          bookingId: `bk_ops_${seq}`,
          message: "Need help with my booking",
        },
        output: {
          category: "general",
          replyQueued: true,
          template: "support-reply",
        },
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
            resource: "ticket-triage@3",
            timestamp: startedAt + 8,
            duration: Math.max(80, durationMs - 60),
            reversibility: "irreversible",
          },
          {
            kind: "send",
            resource: "support-reply",
            timestamp: endedAt - 30,
            duration: 20 + Math.floor(rand() * 20),
            reversibility: "irreversible",
          },
        ],
        logs: [
          {
            level: "info",
            message: "prompt ticket-triage@3 answered",
            data: { via: "smart", cost },
            at: endedAt - 40,
          },
        ],
        durationMs,
        startedAt,
        endedAt,
        dimensions: {
          flow: "support.triage",
          unit: "support",
          tenant,
          prompt: "ticket-triage",
          cost,
          duration_ms: durationMs,
          build_version: "0.11.2",
        },
      });
      i += 1;
      continue;
    }

    // holds.expire / ops.nightlyReconcile — clock-shaped noise
    if (rand() < 0.55) {
      const durationMs = 30 + Math.floor(rand() * 80);
      const endedAt = startedAt + durationMs;
      out.push({
        id: `pw-ops-holds-${seq}`,
        flow: "holds.expire",
        unit: "holds",
        trigger: "every",
        plane: "operator",
        tenant: null,
        principal: "clock_bot",
        gates: [],
        cache: "none",
        buildVersion: "0.11.2",
        output: { expired: 1 + Math.floor(rand() * 5) },
        effects: [
          {
            kind: "read",
            resource: "kv:holds",
            timestamp: startedAt + 2,
            duration: 6,
            reversibility: "none",
          },
          {
            kind: "write",
            resource: "kv:holds",
            timestamp: startedAt + 10,
            duration: 10,
            reversibility: "reversible",
          },
          {
            kind: "emit",
            resource: "hold-expired",
            timestamp: endedAt - 8,
            duration: 4,
            reversibility: "deferred",
          },
        ],
        logs: [
          {
            level: "info",
            message: "expire-holds tick",
            data: { clock: "expire-holds", expired: Math.floor(rand() * 5) },
            at: startedAt + 1,
          },
        ],
        durationMs,
        startedAt,
        endedAt,
        dimensions: {
          flow: "holds.expire",
          unit: "holds",
          plane: "operator",
          clock: "expire-holds",
          duration_ms: durationMs,
          build_version: "0.11.2",
        },
      });
      i += 1;
      continue;
    }

    // ops.nightlyReconcile — rare cron-shaped noise
    const durationMs = 400 + Math.floor(rand() * 900);
    const endedAt = startedAt + durationMs;
    out.push({
      id: `pw-ops-cron-${seq}`,
      flow: "ops.nightlyReconcile",
      unit: "ops",
      trigger: "cron",
      plane: "operator",
      tenant: null,
      principal: "ops_bot",
      gates: [],
      cache: "none",
      replica: "primary",
      buildVersion: "0.11.2",
      effects: [
        {
          kind: "read",
          resource: "sql:bookings",
          timestamp: startedAt + 20,
          duration: 100 + Math.floor(rand() * 200),
          reversibility: "none",
        },
        {
          kind: "write",
          resource: "sql:bookings",
          timestamp: startedAt + 200,
          duration: 150 + Math.floor(rand() * 300),
          reversibility: "reversible",
        },
      ],
      logs: [
        {
          level: "info",
          message: "reconciled open bookings",
          data: { scanned: 200 + Math.floor(rand() * 2000), fixed: Math.floor(rand() * 6) },
          at: endedAt - 15,
        },
      ],
      durationMs,
      startedAt,
      endedAt,
      dimensions: {
        flow: "ops.nightlyReconcile",
        unit: "ops",
        plane: "operator",
        cache: "none",
        clock: "nightly",
        duration_ms: durationMs,
        build_version: "0.11.2",
      },
    });
    i += 1;
  }

  return out.slice(0, count);
}

/**
 * Build the primary seeded WideEvent (`bookings.create` success).
 *
 * @param now - Clock ms (defaults to `Date.now()`)
 */
export function createUiNextSeedRun(now: number = Date.now()): WideEvent {
  const runs = createUiNextSeedRuns(now);
  const primary = runs.find((r) => r.id === UI_NEXT_SEED_RUN_ID);
  if (!primary) {
    throw new Error("ui-next seed: primary bookings.create run missing");
  }
  return primary;
}

/**
 * Append the full ui-next seed WideEvent chain to a Console runs store.
 *
 * @param runs - Booted Console runs store
 * @param now - Clock ms
 */
export async function appendUiNextSeedRun(
  runs: Pick<RunsStore, "append">,
  now: number = Date.now(),
): Promise<readonly WideEvent[]> {
  const seeds = createUiNextSeedRuns(now);
  for (const seed of seeds) {
    await runs.append(seed);
  }
  return seeds;
}

/** Seeded SQL row counts (verifiable in PR/changelog). */
export const UI_NEXT_SEED_STORE_COUNTS = {
  sqlBookings: 5,
  sqlShipments: 3,
  kvHolds: 4,
  filesUploads: 3,
  indexDocs: 4,
} as const;

const SEED_BOOKINGS_ROWS: ReadonlyArray<{
  id: string;
  flight_id: string;
  seats: number;
  email: string;
  note: string;
}> = [
  { id: "bk_8f2a", flight_id: "SK-441", seats: 2, email: "mara@skyport.dev", note: "window seat" },
  { id: "bk_7c1e", flight_id: "SK-118", seats: 1, email: "jon@skyport.dev", note: "ملاحظة الراكب" },
  { id: "bk_3aa0", flight_id: "SK-902", seats: 4, email: "priya@skyport.dev", note: "family row" },
  { id: "bk_5d21", flight_id: "SK-441", seats: 1, email: "lee@skyport.dev", note: "aisle" },
  { id: "bk_9e77", flight_id: "SK-655", seats: 3, email: "nadia@skyport.dev", note: "حجز مؤكد" },
];

const SEED_SHIPMENTS_ROWS: ReadonlyArray<{
  id: string;
  booking_id: string;
}> = [
  { id: "sh_1001", booking_id: "bk_8f2a" },
  { id: "sh_1002", booking_id: "bk_7c1e" },
  { id: "sh_1003", booking_id: "bk_3aa0" },
];

const SEED_HOLDS: ReadonlyArray<{ key: string; value: unknown }> = [
  { key: "hold:SK-441:1", value: { seats: 2, expiresAt: "2026-08-12T00:00:00Z" } },
  { key: "hold:SK-441:2", value: { seats: 1, expiresAt: "2026-08-12T00:05:00Z" } },
  { key: "hold:SK-118:1", value: { seats: 1, expiresAt: "2026-08-12T00:10:00Z" } },
  { key: "hold:SK-902:1", value: { seats: 4, expiresAt: "2026-08-12T00:15:00Z" } },
];

const SEED_UPLOADS: ReadonlyArray<{ key: string; data: string }> = [
  { key: "tickets/bk_8f2a.pdf", data: "ticket-bytes:bk_8f2a" },
  { key: "tickets/bk_7c1e.pdf", data: "ticket-bytes:bk_7c1e" },
  { key: "фото/id.jpg", data: "photo-bytes:id" },
];

const SEED_DOCS: ReadonlyArray<{
  id: string;
  vector: readonly number[];
  meta: Record<string, unknown>;
}> = [
  { id: "doc_bk_8f2a", vector: [1, 0, 0], meta: { booking: "bk_8f2a", kind: "itinerary" } },
  { id: "doc_bk_7c1e", vector: [0, 1, 0], meta: { booking: "bk_7c1e", kind: "itinerary" } },
  { id: "doc_bk_3aa0", vector: [0, 0, 1], meta: { booking: "bk_3aa0", kind: "itinerary" } },
  { id: "doc_bk_5d21", vector: [1, 1, 0], meta: { booking: "bk_5d21", kind: "receipt" } },
];

/**
 * Seed real Store rows/keys/objects/vectors into the Console Manifest memory
 * runtime so every facet browse is non-empty (SQL/KV/Files/Index).
 *
 * @param runtime - Booted Console Store runtime
 */
export async function seedUiNextStoreData(runtime: StoreRuntime): Promise<void> {
  const sql = (await runtime.openRef("sql:db", {
    effects: { writes: ["sql:db"] },
    revealPii: true,
  })) as SqlStoreHandle;

  const bookings = defineTable("bookings", {
    id: true,
    flight_id: true,
    seats: true,
    email: classify({ pii: true }),
    note: true,
  });
  const shipments = defineTable("shipments", {
    id: true,
    booking_id: true,
  });

  await sql.ensureTable(bookings);
  await sql.ensureTable(shipments);
  for (const row of SEED_BOOKINGS_ROWS) {
    await sql.insert(bookings).values(row);
  }
  for (const row of SEED_SHIPMENTS_ROWS) {
    await sql.insert(shipments).values(row);
  }

  const kv = (await runtime.openRef("kv:cache", {
    effects: { writes: ["kv:cache"] },
  })) as KvStoreFxHandle;
  for (const entry of SEED_HOLDS) {
    await kv.set(entry.key, entry.value);
  }

  const files = (await runtime.openRef("files:uploads", {
    effects: { writes: ["files:uploads"] },
  })) as FilesStoreFxHandle;
  for (const entry of SEED_UPLOADS) {
    await files.put(entry.key, entry.data);
  }

  const index = (await runtime.openRef("index:docs", {
    effects: { writes: ["index:docs"] },
  })) as VectorIndexStoreFxHandle;
  for (const entry of SEED_DOCS) {
    await index.upsert(entry.id, entry.vector, entry.meta);
  }
}

/**
 * True when `OKE_CONSOLE_NEXT_SEEDED=1` (seeded `dev:console-next:seed` mode).
 */
export function isConsoleNextSeeded(): boolean {
  return process.env["OKE_CONSOLE_NEXT_SEEDED"] === "1";
}

/**
 * One-line description of what seeded mode preloads.
 */
export function uiNextSeededSummary(): string {
  return (
    `skyport graph (all 8 elements) + ${UI_NEXT_SEED_TOTAL_COUNT} traces ` +
    `(featured chain + AI triage + clocks + ${UI_NEXT_SEED_OPERATION_COUNT} ops) — ` +
    `click ${UI_NEXT_SEED_RUN_ID} to highlight the chain`
  );
}
