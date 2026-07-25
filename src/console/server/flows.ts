/**
 * Console flows — every action is a real operator-plane flow through `fx`.
 *
 * The audit log is the trace (console §1 · §6).
 */

import { z } from "zod";
import {
  authenticateOperator,
  createOperator,
  issueSession,
  userPrincipal,
  type IssuedSession,
} from "../../auth/index.ts";
import { DryRunWriteIsolationError } from "../../kernel/dry-run.ts";
import { fail, flow, http, type Binding } from "../../kernel/index.ts";
import type { Flow as ManifestFlow, ResourceRef } from "../../manifest/types.ts";
import type { WideEvent } from "../../runs/types.ts";
import { bindHttp } from "./bind.ts";
import { verifyClaimCode } from "./claim.ts";
import { createFileDiff, emitStructuralDiff } from "./structural.ts";
import type { ConsoleState } from "./state.ts";
import { tenancyDeclared } from "./store.ts";

/** Flows that may run without an operator session. */
export const PUBLIC_CONSOLE_FLOWS = new Set([
  "console.setup.status",
  "console.setup.claim",
  "console.session.login",
]);

const SetupStatusOut = z.object({
  setupClosed: z.boolean(),
  claimRequired: z.boolean(),
});

const ClaimIn = z.object({
  claimCode: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
});

const SessionOut = z.object({
  operatorId: z.string(),
  email: z.string(),
  name: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  accessExpiresAt: z.number(),
});

const LoginIn = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const MeOut = z.object({
  operatorId: z.string(),
  email: z.string(),
  name: z.string(),
  setupClosed: z.boolean(),
});

const ManifestOut = z.object({
  manifest: z.unknown().nullable(),
});

const EffectEntryOut = z.object({
  kind: z.enum([
    "read",
    "write",
    "emit",
    "send",
    "ask",
    "secret",
    "call",
  ]),
  resource: z.string(),
  timestamp: z.number(),
  duration: z.number(),
  reversibility: z.enum([
    "none",
    "reversible",
    "deferred",
    "irreversible",
    "capability",
    "portal",
  ]),
});

const LogLineOut = z.object({
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
  at: z.number(),
});

/** Wide-event projection — Runs · Traces · Overview share one store (console §9.11). */
const RunsListOut = z.object({
  runs: z.array(
    z.object({
      id: z.string(),
      parentId: z.string().nullable(),
      flow: z.string(),
      unit: z.string().nullable(),
      trigger: z.string(),
      plane: z.string(),
      tenant: z.string().nullable(),
      principal: z.string().nullable(),
      gates: z.array(z.string()),
      cache: z.enum(["hit", "miss", "none"]),
      replica: z.enum(["primary", "replica"]).nullable(),
      replicaLagMs: z.number().nullable(),
      cost: z.number().nullable(),
      promptVersion: z.number().nullable(),
      buildVersion: z.string().nullable(),
      startedAt: z.number(),
      endedAt: z.number(),
      durationMs: z.number(),
      error: z.string().nullable(),
      sampled: z.enum(["full", "error", "sample", "boost"]),
      effects: z.array(EffectEntryOut),
      /** `fx.log` lines — a field on the run, not a parallel stream. */
      logs: z.array(LogLineOut),
      /** All queryable dimensions for population analysis. */
      dimensions: z.record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.null()]),
      ),
    }),
  ),
});

const TracesReplayIn = z.object({
  rootId: z.string().min(1),
  dryRun: z.boolean(),
});

const TracesReplayOut = z.object({
  ok: z.literal(true),
  rootId: z.string(),
  dryRun: z.boolean(),
  at: z.number(),
});

const SignalEndpointOut = z.object({
  flowId: z.string(),
  durable: z.boolean(),
  external: z.boolean(),
  peakTier: z.enum([
    "none",
    "reads",
    "writes",
    "emits",
    "external",
    "capabilities",
  ]),
});

const DeadLetterOut = z.object({
  id: z.string(),
  signal: z.string(),
  payload: z.unknown(),
  delivery: z.enum(["once", "broadcast", "live"]),
  attempts: z.number(),
  failures: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      at: z.number(),
      attempt: z.number(),
    }),
  ),
  createdAt: z.number(),
  availableAt: z.number(),
  status: z.literal("dead"),
  causeRunId: z.string().optional(),
  causeFlow: z.string().optional(),
});

const SignalsListOut = z.object({
  signals: z.array(
    z.object({
      name: z.string(),
      delivery: z.enum(["once", "broadcast", "live"]),
      retries: z.number(),
      deadLetterEnabled: z.boolean(),
      orphaned: z.boolean(),
      pending: z.number(),
      inflight: z.number(),
      dead: z.number(),
      delivered: z.number(),
      outboxLagMs: z.number().nullable(),
      connections: z.number(),
      throughputPerSec: z.number(),
      schema: z.unknown().optional(),
      subscribers: z.array(
        z.object({
          id: z.string(),
          lag: z.number(),
          errorCount: z.number(),
        }),
      ),
      recentLive: z.array(z.unknown()),
      deadLetters: z.array(DeadLetterOut),
      producers: z.array(SignalEndpointOut),
      consumers: z.array(SignalEndpointOut),
      consumersDurable: z.boolean().nullable(),
    }),
  ),
});

const SignalsReplayIn = z.object({
  signal: z.string().min(1),
  messageIds: z.array(z.string()).optional(),
  subscriberId: z.string().optional(),
  ratePerSec: z.number().min(1).max(1_000).default(10),
  dryRun: z.boolean(),
  payloads: z.record(z.string(), z.unknown()).optional(),
  /** Typed confirmation phrase for irreversible production replay. */
  confirmation: z.string().optional(),
  /** Recorded reason for irreversible production replay. */
  reason: z.string().optional(),
});

const SignalsReplayOut = z.object({
  ok: z.literal(true),
  attempted: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  dryRun: z.boolean(),
  results: z.array(
    z.object({
      id: z.string(),
      ok: z.boolean(),
      error: z
        .object({ code: z.string(), message: z.string() })
        .optional(),
    }),
  ),
  wouldHaveFired: z.array(
    z.object({
      kind: z.enum(["send", "ask"]),
      resource: z.string(),
      messageId: z.string().optional(),
    }),
  ),
  at: z.number(),
});

const SignalsDiscardIn = z.object({
  signal: z.string().min(1),
  messageIds: z.array(z.string()).min(1),
  confirmation: z.string().optional(),
  reason: z.string().optional(),
});

const SignalsDiscardOut = z.object({
  ok: z.literal(true),
  discarded: z.number(),
  at: z.number(),
});

const ActionPingIn = z.object({
  note: z.string().optional(),
});

const ActionPingOut = z.object({
  ok: z.literal(true),
  note: z.string().optional(),
  at: z.number(),
});

const StructuralIn = z.object({
  title: z.string().min(1),
  relativePath: z.string().min(1),
  contents: z.string(),
  reason: z.string().min(1),
});

const StructuralOut = z.object({
  id: z.string(),
  path: z.string(),
  applied: z.literal(false),
});

const IdentitiesOut = z.object({
  identities: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      name: z.string(),
      status: z.enum(["active", "disabled"]),
      scopes: z.array(z.string()),
    }),
  ),
});

const InvokeIn = z.object({
  flowId: z.string().min(1),
  body: z.unknown(),
  asUserId: z.string().min(1),
  /** Typed confirmation phrase for irreversible production invokes. */
  confirmation: z.string().optional(),
  /** Recorded reason for irreversible production invokes. */
  reason: z.string().optional(),
});

const InvokeOut = z.object({
  ok: z.literal(true),
  flowId: z.string(),
  asUserId: z.string(),
  trigger: z.enum(["http", "signal", "clock", "internal", "durable"]),
  response: z.unknown(),
  peakTier: z.enum([
    "none",
    "reads",
    "writes",
    "emits",
    "external",
    "capabilities",
  ]),
  auditedAt: z.number(),
});

const SetupClosed = z.object({ reason: z.string() });
const ClaimFailed = z.object({ reason: z.string() });
const AuthFailed = z.object({});
const NotFound = z.object({ flowId: z.string() });
const InvokeDenied = z.object({ reason: z.string() });
const ConfirmRequired = z.object({
  phrase: z.enum(["INVOKE", "REPLAY", "DISCARD", "EDIT", "DELETE", "PURGE"]),
  reason: z.string(),
});

const SignalNotFound = z.object({ signal: z.string() });
const DryRunUnsafe = z.object({
  signal: z.string().optional(),
  ref: z.string().optional(),
  reason: z.string(),
});

const TenantRequired = z.object({
  reason: z.string(),
});

const StoreNotFound = z.object({ ref: z.string() });

const WillNotFireOut = z.object({
  writerFlowIds: z.array(z.string()),
  signals: z.array(z.string()),
  channels: z.array(z.string()),
});

const StoreListOut = z.object({
  tenancyDeclared: z.boolean(),
  tenants: z.array(z.string()),
  stores: z.array(
    z.object({
      ref: z.string(),
      facet: z.enum(["sql", "kv", "files", "index"]),
      name: z.string(),
      children: z.array(
        z.object({
          name: z.string(),
          effectRef: z.string(),
          writers: z.array(z.string()),
          readers: z.array(z.string()),
          cache: z.object({
            producedByRead: z.string(),
            invalidatedByWrites: z.array(z.string()),
            invalidatingFlowIds: z.array(z.string()),
          }),
          willNotFire: WillNotFireOut,
          piiColumns: z.array(z.string()),
        }),
      ),
      replicaLagMs: z.number().nullable(),
      migrationDrift: z
        .object({
          declared: z.string(),
          applied: z.string().nullable(),
          drifted: z.boolean(),
        })
        .nullable(),
      contentAddressed: z.boolean(),
      warnings: z.array(
        z.object({
          code: z.string(),
          message: z.string(),
          key: z.string(),
        }),
      ),
    }),
  ),
});

const StoreQueryIn = z.object({
  ref: z.string().min(1),
  child: z.string().optional(),
  tenant: z.string().optional(),
  prefix: z.string().optional(),
  limit: z.number().min(1).max(500).optional(),
  vector: z.array(z.number()).optional(),
  topK: z.number().min(1).max(100).optional(),
});

const StoreQueryOut = z.object({
  facet: z.enum(["sql", "kv", "files", "index"]),
  rows: z.array(z.record(z.string(), z.unknown())).optional(),
  keys: z
    .array(
      z.object({
        key: z.string(),
        value: z.unknown().optional(),
        warnings: z
          .array(z.object({ code: z.string(), message: z.string() }))
          .optional(),
      }),
    )
    .optional(),
  hits: z
    .array(
      z.object({
        id: z.string(),
        score: z.number(),
        meta: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
  masked: z.boolean(),
  routedRole: z.enum(["primary", "replica"]).optional(),
});

const StoreRevealIn = z.object({
  ref: z.string().min(1),
  child: z.string().optional(),
  tenant: z.string().optional(),
  id: z.string().min(1),
  column: z.string().min(1),
});

const StoreRevealOut = z.object({
  ok: z.literal(true),
  value: z.unknown(),
  at: z.number(),
});

const StoreEditIn = z.object({
  ref: z.string().min(1),
  child: z.string().optional(),
  tenant: z.string().optional(),
  id: z.string().optional(),
  key: z.string().optional(),
  patch: z.record(z.string(), z.unknown()),
  confirmation: z.string().optional(),
  reason: z.string().optional(),
  /** When false/omitted, returns willNotFire without applying. */
  commit: z.boolean().optional(),
});

const StoreEditOut = z.object({
  ok: z.literal(true),
  dryRun: z.boolean(),
  applied: z.boolean(),
  willNotFire: WillNotFireOut,
  wouldHaveFired: z.array(
    z.object({
      kind: z.enum(["send", "ask"]),
      resource: z.string(),
    }),
  ),
  at: z.number(),
});

const StoreDeleteIn = z.object({
  ref: z.string().min(1),
  child: z.string().optional(),
  tenant: z.string().optional(),
  ids: z.array(z.string()).optional(),
  keys: z.array(z.string()).optional(),
  confirmation: z.string().optional(),
  reason: z.string().optional(),
});

const StoreDeleteOut = z.object({
  ok: z.literal(true),
  deleted: z.number(),
  at: z.number(),
});

const StorePurgeIn = z.object({
  resource: z.string().min(1),
  confirmation: z.string().optional(),
  reason: z.string().optional(),
});

const StorePurgeOut = z.object({
  ok: z.literal(true),
  keys: z.array(z.string()),
  at: z.number(),
});

const StoreSqlIn = z.object({
  ref: z.string().min(1),
  sql: z.string().min(1),
  tenant: z.string().optional(),
  allowWrite: z.boolean().optional(),
});

const StoreSqlOut = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
  masked: z.boolean(),
  routedRole: z.enum(["primary", "replica"]),
});

const StorePreviewIn = z.object({
  ref: z.string().min(1),
  child: z.string().optional(),
  tenant: z.string().optional(),
  id: z.string().optional(),
  key: z.string().optional(),
  patch: z.record(z.string(), z.unknown()),
});

const StorePreviewOut = z.object({
  ok: z.literal(true),
  dryRun: z.literal(true),
  willNotFire: WillNotFireOut,
  wouldHaveFired: z.array(
    z.object({
      kind: z.enum(["send", "ask"]),
      resource: z.string(),
    }),
  ),
  at: z.number(),
});

/**
 * Build all Console HTTP bindings against shared state.
 *
 * @param state - Console state
 */
export function createConsoleBindings(state: ConsoleState): {
  readonly bindings: Binding[];
  readonly routes: {
    readonly setup: {
      readonly status: ReturnType<typeof createSetupStatus>;
      readonly claim: ReturnType<typeof createSetupClaim>;
    };
    readonly session: {
      readonly login: ReturnType<typeof createSessionLogin>;
      readonly me: ReturnType<typeof createSessionMe>;
      readonly logout: ReturnType<typeof createSessionLogout>;
    };
    readonly manifest: { readonly get: ReturnType<typeof createManifestGet> };
    readonly runs: { readonly list: ReturnType<typeof createRunsList> };
    readonly action: { readonly ping: ReturnType<typeof createActionPing> };
    readonly structural: {
      readonly propose: ReturnType<typeof createStructuralPropose>;
    };
    readonly flows: {
      readonly identities: ReturnType<typeof createFlowsIdentities>;
      readonly invoke: ReturnType<typeof createFlowsInvoke>;
    };
    readonly traces: {
      readonly replay: ReturnType<typeof createTracesReplay>;
    };
    readonly signals: {
      readonly list: ReturnType<typeof createSignalsList>;
      readonly replay: ReturnType<typeof createSignalsReplay>;
      readonly dryRunReplay: ReturnType<typeof createSignalsDryRunReplay>;
      readonly discard: ReturnType<typeof createSignalsDiscard>;
    };
    readonly store: {
      readonly list: ReturnType<typeof createStoreList>;
      readonly query: ReturnType<typeof createStoreQuery>;
      readonly reveal: ReturnType<typeof createStoreReveal>;
      readonly edit: ReturnType<typeof createStoreEdit>;
      readonly delete: ReturnType<typeof createStoreDelete>;
      readonly purgeCache: ReturnType<typeof createStorePurgeCache>;
      readonly sql: ReturnType<typeof createStoreSql>;
      readonly preview: ReturnType<typeof createStorePreview>;
    };
  };
} {
  const setupStatus = createSetupStatus(state);
  const setupClaim = createSetupClaim(state);
  const sessionLogin = createSessionLogin(state);
  const sessionMe = createSessionMe(state);
  const sessionLogout = createSessionLogout();
  const manifestGet = createManifestGet(state);
  const runsList = createRunsList(state);
  const actionPing = createActionPing(state);
  const structuralPropose = createStructuralPropose(state);
  const flowsIdentities = createFlowsIdentities(state);
  const flowsInvoke = createFlowsInvoke(state);
  const tracesReplay = createTracesReplay(state);
  const signalsList = createSignalsList(state);
  const signalsReplay = createSignalsReplay(state);
  const signalsDryRunReplay = createSignalsDryRunReplay(state);
  const signalsDiscard = createSignalsDiscard(state);
  const storeList = createStoreList(state);
  const storeQuery = createStoreQuery(state);
  const storeReveal = createStoreReveal(state);
  const storeEdit = createStoreEdit(state);
  const storeDelete = createStoreDelete(state);
  const storePurgeCache = createStorePurgeCache(state);
  const storeSql = createStoreSql(state);
  const storePreview = createStorePreview(state);

  const bindings: Binding[] = [
    bindHttp(http.get("/console/setup/status"), setupStatus),
    bindHttp(http.post("/console/setup/claim"), setupClaim),
    bindHttp(http.post("/console/session/login"), sessionLogin),
    bindHttp(http.get("/console/session/me"), sessionMe),
    bindHttp(http.post("/console/session/logout"), sessionLogout),
    bindHttp(http.get("/console/manifest"), manifestGet),
    bindHttp(http.get("/console/runs"), runsList),
    bindHttp(http.post("/console/action/ping"), actionPing),
    bindHttp(http.post("/console/structural/propose"), structuralPropose),
    bindHttp(http.get("/console/flows/identities"), flowsIdentities),
    bindHttp(http.post("/console/flows/invoke"), flowsInvoke),
    bindHttp(http.post("/console/traces/replay"), tracesReplay),
    bindHttp(http.get("/console/signals"), signalsList),
    bindHttp(http.post("/console/signals/replay"), signalsReplay),
    bindHttp(http.post("/console/signals/dry-run-replay"), signalsDryRunReplay),
    bindHttp(http.post("/console/signals/discard"), signalsDiscard),
    bindHttp(http.get("/console/store"), storeList),
    bindHttp(http.post("/console/store/query"), storeQuery),
    bindHttp(http.post("/console/store/reveal"), storeReveal),
    bindHttp(http.post("/console/store/edit"), storeEdit),
    bindHttp(http.post("/console/store/delete"), storeDelete),
    bindHttp(http.post("/console/store/purge-cache"), storePurgeCache),
    bindHttp(http.post("/console/store/sql"), storeSql),
    bindHttp(http.post("/console/store/preview"), storePreview),
  ];

  return {
    bindings,
    routes: {
      setup: { status: setupStatus, claim: setupClaim },
      session: { login: sessionLogin, me: sessionMe, logout: sessionLogout },
      manifest: { get: manifestGet },
      runs: { list: runsList },
      action: { ping: actionPing },
      structural: { propose: structuralPropose },
      flows: { identities: flowsIdentities, invoke: flowsInvoke },
      traces: { replay: tracesReplay },
      signals: {
        list: signalsList,
        replay: signalsReplay,
        dryRunReplay: signalsDryRunReplay,
        discard: signalsDiscard,
      },
      store: {
        list: storeList,
        query: storeQuery,
        reveal: storeReveal,
        edit: storeEdit,
        delete: storeDelete,
        purgeCache: storePurgeCache,
        sql: storeSql,
        preview: storePreview,
      },
    },
  };
}

function createSetupStatus(state: ConsoleState) {
  return flow({
    name: "console.setup.status",
    unit: "console",
    plane: "operator",
    out: SetupStatusOut,
    do: () => ({
      setupClosed: state.setupClosed,
      claimRequired: !state.setupClosed,
    }),
  });
}

function createSetupClaim(state: ConsoleState) {
  return flow({
    name: "console.setup.claim",
    unit: "console",
    plane: "operator",
    in: ClaimIn,
    out: SessionOut,
    errors: { SetupClosed, ClaimFailed },
    do: async (input: z.infer<typeof ClaimIn>, fx) => {
      if (state.setupClosed) {
        return fail("SetupClosed", { reason: "first operator already exists" });
      }
      const verified = verifyClaimCode(state.claim, input.claimCode, state.now);
      if (!verified.ok) {
        return fail("ClaimFailed", { reason: verified.reason });
      }
      const op = await createOperator(state.operators, {
        email: input.email,
        name: input.name,
        password: input.password,
      });
      const issued = await issueOperatorSession(state, op.id);
      fx.log.info("console.setup.claim", { operatorId: op.id });
      return sessionPayload(op.id, op.email, op.name, issued);
    },
  });
}

function createSessionLogin(state: ConsoleState) {
  return flow({
    name: "console.session.login",
    unit: "console",
    plane: "operator",
    in: LoginIn,
    out: SessionOut,
    errors: { AuthFailed },
    do: async (input: z.infer<typeof LoginIn>, fx) => {
      const op = await authenticateOperator(
        state.operators,
        input.email,
        input.password,
      );
      if (!op) return fail("AuthFailed", {});
      const issued = await issueOperatorSession(state, op.id);
      fx.log.info("console.session.login", { operatorId: op.id });
      return sessionPayload(op.id, op.email, op.name, issued);
    },
  });
}

function createSessionMe(state: ConsoleState) {
  return flow({
    name: "console.session.me",
    unit: "console",
    plane: "operator",
    out: MeOut,
    errors: { AuthFailed },
    do: (_input, fx) => {
      const id = fx.operator.id;
      if (!id) return fail("AuthFailed", {});
      const op = state.operators.operators.get(id);
      if (!op) return fail("AuthFailed", {});
      return {
        operatorId: op.id,
        email: op.email,
        name: op.name,
        setupClosed: state.setupClosed,
      };
    },
  });
}

function createSessionLogout() {
  return flow({
    name: "console.session.logout",
    unit: "console",
    plane: "operator",
    out: z.object({ ok: z.literal(true) }),
    do: (_input, fx) => {
      fx.log.info("console.session.logout", {
        operatorId: fx.operator.id,
      });
      return { ok: true as const };
    },
  });
}

function createManifestGet(state: ConsoleState) {
  return flow({
    name: "console.manifest.get",
    unit: "console",
    plane: "operator",
    out: ManifestOut,
    errors: { AuthFailed },
    do: (_input, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      return { manifest: state.manifest };
    },
  });
}

function createRunsList(state: ConsoleState) {
  return flow({
    name: "console.runs.list",
    unit: "console",
    plane: "operator",
    out: RunsListOut,
    errors: { AuthFailed },
    do: async (_input, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const all = await state.listRuns();
      return {
        runs: all.map((r) => projectRun(r)),
      };
    },
  });
}

/**
 * Project a wide event for GET /console/runs (Runs · Traces · Overview).
 *
 * @param r - Stored wide event
 */
function projectRun(r: WideEvent) {
  const dimensions: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(r.dimensions)) {
    if (v === undefined) continue;
    dimensions[k] = v;
  }
  return {
    id: r.id,
    parentId: r.parentId ?? null,
    flow: r.flow,
    unit: r.unit ?? null,
    trigger: r.trigger,
    plane: r.plane,
    tenant: r.tenant ?? null,
    principal: r.principal ?? null,
    gates: [...r.gates],
    cache: r.cache,
    replica: r.replica ?? null,
    replicaLagMs: r.replicaLagMs ?? null,
    cost: r.cost ?? null,
    promptVersion: r.promptVersion ?? null,
    buildVersion: r.buildVersion ?? null,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    durationMs: r.durationMs,
    error: r.error?.code ?? null,
    sampled: r.error ? ("error" as const) : ("sample" as const),
    effects: r.effects.map((e) => ({
      kind: e.kind,
      resource: e.resource,
      timestamp: e.timestamp,
      duration: e.duration,
      reversibility: e.reversibility,
    })),
    logs: r.logs.map((line) => ({
      level: line.level,
      message: line.message,
      ...(line.data !== undefined ? { data: line.data } : {}),
      at: line.at,
    })),
    dimensions,
  };
}

function createTracesReplay(state: ConsoleState) {
  return flow({
    name: "console.traces.replay",
    unit: "console",
    plane: "operator",
    in: TracesReplayIn,
    out: TracesReplayOut,
    errors: { AuthFailed, NotFound },
    do: async (input: z.infer<typeof TracesReplayIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const all = await state.listRuns();
      const root = all.find((r) => r.id === input.rootId);
      if (!root) return fail("NotFound", { flowId: input.rootId });
      fx.log.info("console.traces.replay", {
        operatorId: fx.operator.id,
        rootId: input.rootId,
        dryRun: input.dryRun,
        flow: root.flow,
      });
      return {
        ok: true as const,
        rootId: input.rootId,
        dryRun: input.dryRun,
        at: Date.now(),
      };
    },
  });
}

function createSignalsList(state: ConsoleState) {
  return flow({
    name: "console.signals.list",
    unit: "console",
    plane: "operator",
    out: SignalsListOut,
    errors: { AuthFailed },
    do: async (_input, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const signals = await state.listSignals();
      return { signals: [...signals] };
    },
  });
}

function createSignalsReplay(state: ConsoleState) {
  return flow({
    name: "console.signals.replay",
    unit: "console",
    plane: "operator",
    in: SignalsReplayIn,
    out: SignalsReplayOut,
    errors: { AuthFailed, SignalNotFound, ConfirmRequired },
    do: async (input: z.infer<typeof SignalsReplayIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      return runSignalReplay(state, fx, { ...input, dryRun: false });
    },
  });
}

function createSignalsDryRunReplay(state: ConsoleState) {
  return flow({
    name: "console.signals.dryRunReplay",
    unit: "console",
    plane: "operator",
    in: SignalsReplayIn.omit({ dryRun: true }),
    out: SignalsReplayOut,
    errors: { AuthFailed, SignalNotFound, DryRunUnsafe },
    do: async (
      input: Omit<z.infer<typeof SignalsReplayIn>, "dryRun">,
      fx,
    ) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      return runSignalReplay(state, fx, { ...input, dryRun: true });
    },
  });
}

function createSignalsDiscard(state: ConsoleState) {
  return flow({
    name: "console.signals.discard",
    unit: "console",
    plane: "operator",
    in: SignalsDiscardIn,
    out: SignalsDiscardOut,
    errors: { AuthFailed, SignalNotFound, ConfirmRequired },
    do: async (input: z.infer<typeof SignalsDiscardIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const rows = await state.listSignals();
      const row = rows.find((s) => s.name === input.signal);
      if (!row) return fail("SignalNotFound", { signal: input.signal });

      const irreversible =
        state.production &&
        row.consumers.some((c) => c.external || !c.durable);
      if (irreversible) {
        if (
          input.confirmation !== "DISCARD" ||
          (input.reason?.trim().length ?? 0) < 3
        ) {
          return fail("ConfirmRequired", {
            phrase: "DISCARD" as const,
            reason: "discarding dead letters requires typed confirmation",
          });
        }
      }

      const result = await state.discardSignals({
        signal: input.signal,
        messageIds: input.messageIds,
      });
      fx.log.info("console.signals.discard", {
        operatorId: fx.operator.id,
        signal: input.signal,
        discarded: result.discarded,
        reason: input.reason,
      });
      return {
        ok: true as const,
        discarded: result.discarded,
        at: state.now(),
      };
    },
  });
}

async function runSignalReplay(
  state: ConsoleState,
  fx: {
    operator: { id: string | null };
    log: { info: (m: string, data?: Record<string, unknown>) => void };
  },
  input: z.infer<typeof SignalsReplayIn>,
) {
  const rows = await state.listSignals();
  const row = rows.find((s) => s.name === input.signal);
  if (!row) return fail("SignalNotFound", { signal: input.signal });

  if (input.dryRun) {
    // Same refusal spirit as Traces: if we cannot offer a safe stubbed
    // dry run for this consumer shape, refuse rather than risk a side effect.
    const safety = dryRunSafety(row);
    if (!safety.ok) {
      return fail("DryRunUnsafe", {
        signal: input.signal,
        reason: safety.reason,
      });
    }
  } else {
    const retriggersExternal =
      state.production &&
      row.consumers.some((c) => c.external) &&
      row.consumersDurable !== true;
    if (retriggersExternal) {
      if (
        input.confirmation !== "REPLAY" ||
        (input.reason?.trim().length ?? 0) < 3
      ) {
        return fail("ConfirmRequired", {
          phrase: "REPLAY" as const,
          reason:
            "replay re-triggers an external effect; typed confirmation required",
        });
      }
    }
  }

  const result = await state.replaySignals({
    signal: input.signal,
    messageIds: input.messageIds,
    subscriberId: input.subscriberId,
    ratePerSec: input.ratePerSec,
    dryRun: input.dryRun,
    payloads: input.payloads,
  });
  if (result.refused) {
    return fail("DryRunUnsafe", {
      signal: input.signal,
      reason: result.refused.reason,
    });
  }
  fx.log.info(
    input.dryRun
      ? "console.signals.dryRunReplay"
      : "console.signals.replay",
    {
      operatorId: fx.operator.id,
      signal: input.signal,
      attempted: result.attempted,
      succeeded: result.succeeded,
      failed: result.failed,
      dryRun: result.dryRun,
      ratePerSec: input.ratePerSec,
      reason: input.reason,
      wouldHaveFired: result.wouldHaveFired.length,
    },
  );
  return {
    ok: true as const,
    attempted: result.attempted,
    succeeded: result.succeeded,
    failed: result.failed,
    dryRun: result.dryRun,
    results: [...result.results],
    wouldHaveFired: [...result.wouldHaveFired],
    at: state.now(),
  };
}

/**
 * Whether a dry-run can be offered safely for this signal.
 *
 * Orphaned / unknown consumers cannot be stubbed with confidence — refuse,
 * the same way Traces refuses a live replay when it cannot offer a safe dry run.
 *
 * @param row - Projected signal row
 */
function dryRunSafety(row: {
  readonly orphaned: boolean;
  readonly consumers: ReadonlyArray<{ readonly flowId: string }>;
}): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (row.orphaned) {
    return {
      ok: false,
      reason:
        "Orphaned signal — consumer shape unknown; dry-run refused rather than risk a side effect.",
    };
  }
  if (row.consumers.length === 0) {
    return {
      ok: false,
      reason:
        "No Manifest consumer — dry-run refused rather than invoke an unknown handler unsafely.",
    };
  }
  return { ok: true };
}

function createActionPing(state: ConsoleState) {
  return flow({
    name: "console.action.ping",
    unit: "console",
    plane: "operator",
    in: ActionPingIn,
    out: ActionPingOut,
    errors: { AuthFailed },
    do: (input: z.infer<typeof ActionPingIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      fx.log.info("console.action.ping", {
        operatorId: fx.operator.id,
        note: input.note,
      });
      return { ok: true as const, note: input.note, at: state.now() };
    },
  });
}

function createStructuralPropose(state: ConsoleState) {
  return flow({
    name: "console.structural.propose",
    unit: "console",
    plane: "operator",
    in: StructuralIn,
    out: StructuralOut,
    errors: { AuthFailed },
    do: async (input: z.infer<typeof StructuralIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const proposal = await emitStructuralDiff({
        cwd: state.cwd,
        title: input.title,
        relativePath: input.relativePath,
        diff: createFileDiff(input.relativePath, input.contents),
        actorId: fx.operator.id,
        reason: input.reason,
        now: state.now,
      });
      fx.log.info("console.structural.propose", {
        id: proposal.id,
        path: proposal.path,
      });
      return { id: proposal.id, path: proposal.path, applied: false as const };
    },
  });
}

function createFlowsIdentities(state: ConsoleState) {
  return flow({
    name: "console.flows.identities",
    unit: "console",
    plane: "operator",
    out: IdentitiesOut,
    errors: { AuthFailed },
    do: (_input, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      return {
        identities: state.identities.map((i) => ({
          id: i.id,
          email: i.email,
          name: i.name,
          status: i.status,
          scopes: [...i.scopes],
        })),
      };
    },
  });
}

function createFlowsInvoke(state: ConsoleState) {
  return flow({
    name: "console.flows.invoke",
    unit: "console",
    plane: "operator",
    in: InvokeIn,
    out: InvokeOut,
    errors: { AuthFailed, NotFound, InvokeDenied, ConfirmRequired },
    do: (input: z.infer<typeof InvokeIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const manifest = state.manifest;
      const declared = manifest?.flows?.[input.flowId];
      if (!declared) {
        return fail("NotFound", { flowId: input.flowId });
      }

      const identity = state.identities.find((i) => i.id === input.asUserId);
      if (!identity || identity.status !== "active") {
        return fail("InvokeDenied", { reason: "identity not found or disabled" });
      }

      // Operators hold no application scopes — `console:flows:invoke-as`
      // (covered by session `console:*`) is the grant to assume a user principal.
      const assumed = userPrincipal({
        userId: identity.id,
        scopes: identity.scopes,
        verified: true,
      });

      const peakTier = peakTierOf(declared);
      if (peakTier === "external" && state.production) {
        if (input.confirmation !== "INVOKE" || (input.reason?.trim().length ?? 0) < 3) {
          return fail("ConfirmRequired", {
            phrase: "INVOKE" as const,
            reason: "irreversible production invoke requires typed confirmation",
          });
        }
      }

      const trigger = triggerKindOf(declared);
      const response = stubResponse(declared, input.body);
      fx.log.info("console.flows.invoke", {
        operatorId: fx.operator.id,
        flowId: input.flowId,
        asUserId: assumed.userId,
        scopes: [...assumed.scopes],
        peakTier,
        reason: input.reason,
      });

      return {
        ok: true as const,
        flowId: input.flowId,
        asUserId: input.asUserId,
        trigger,
        response,
        peakTier,
        auditedAt: state.now(),
      };
    },
  });
}

function peakTierOf(
  flow: ManifestFlow,
): "none" | "reads" | "writes" | "emits" | "external" | "capabilities" {
  const e = flow.effects;
  if (!e) return "none";
  if ((e.sends?.length ?? 0) > 0 || (e.asks?.length ?? 0) > 0) return "external";
  if ((e.secrets?.length ?? 0) > 0) return "capabilities";
  if ((e.emits?.length ?? 0) > 0) return "emits";
  if ((e.writes?.length ?? 0) > 0) return "writes";
  if ((e.reads?.length ?? 0) > 0) return "reads";
  return "none";
}

function triggerKindOf(
  flow: ManifestFlow,
): "http" | "signal" | "clock" | "internal" | "durable" {
  if (flow.durable) return "durable";
  if (flow.trigger?.http) return "http";
  if (flow.trigger?.signal) return "signal";
  if (flow.trigger?.cron || flow.trigger?.every) return "clock";
  return "internal";
}

/**
 * Deterministic stub response for Console invoke — echoes the request under
 * `echo` and fills required `out` string fields when declared.
 *
 * @param flow - Manifest flow
 * @param body - Request body
 */
function stubResponse(flow: ManifestFlow, body: unknown): unknown {
  const out = flow.out;
  if (out && typeof out === "object" && !Array.isArray(out)) {
    const props = (out.properties ?? {}) as Record<string, unknown>;
    const required = Array.isArray(out.required)
      ? (out.required as string[])
      : Object.keys(props);
    const result: Record<string, unknown> = { echo: body };
    for (const key of required) {
      if (key === "id") result.id = `inv_${hashShort(body)}`;
      else if (!(key in result)) result[key] = null;
    }
    return result;
  }
  return { echo: body, ok: true };
}

function hashShort(value: unknown): string {
  const text = JSON.stringify(value) ?? "";
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

async function issueOperatorSession(
  state: ConsoleState,
  operatorId: string,
): Promise<IssuedSession> {
  return issueSession(state.sessions, { secret: state.secret, now: state.now }, {
    id: operatorId,
    plane: "operator",
    scopes: ["console:*"],
  });
}

function sessionPayload(
  operatorId: string,
  email: string,
  name: string,
  issued: IssuedSession,
) {
  return {
    operatorId,
    email,
    name,
    accessToken: issued.accessToken,
    refreshToken: issued.refreshToken,
    accessExpiresAt: issued.accessExpiresAt,
  };
}

/**
 * Require tenant when `manifest.tenancy` is declared (off by default).
 *
 * @param state - Console state
 * @param tenant - Optional tenant from the request
 */
function requireTenantIfDeclared(
  state: ConsoleState,
  tenant: string | undefined,
): ReturnType<typeof fail> | null {
  if (!tenancyDeclared(state.manifest)) return null;
  if (tenant !== undefined && tenant.length > 0) return null;
  if (!state.production) return null;
  return fail("TenantRequired", {
    reason:
      "tenancy is declared — tenant selector is required (compliance boundary)",
  });
}

function createStoreList(state: ConsoleState) {
  return flow({
    name: "console.store.list",
    unit: "console",
    plane: "operator",
    out: StoreListOut,
    errors: { AuthFailed },
    do: async (_input, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      return state.listStores();
    },
  });
}

function createStoreQuery(state: ConsoleState) {
  return flow({
    name: "console.store.query",
    unit: "console",
    plane: "operator",
    in: StoreQueryIn,
    out: StoreQueryOut,
    errors: { AuthFailed, TenantRequired, StoreNotFound },
    do: async (input: z.infer<typeof StoreQueryIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const tenantFail = requireTenantIfDeclared(state, input.tenant);
      if (tenantFail) return tenantFail;
      return state.queryStore({
        ref: input.ref as ResourceRef,
        child: input.child,
        tenant: input.tenant,
        prefix: input.prefix,
        limit: input.limit,
        vector: input.vector,
        topK: input.topK,
      });
    },
  });
}

function createStoreReveal(state: ConsoleState) {
  return flow({
    name: "console.store.reveal",
    unit: "console",
    plane: "operator",
    in: StoreRevealIn,
    out: StoreRevealOut,
    errors: { AuthFailed, TenantRequired, StoreNotFound },
    do: async (input: z.infer<typeof StoreRevealIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const tenantFail = requireTenantIfDeclared(state, input.tenant);
      if (tenantFail) return tenantFail;
      const result = await state.queryStore({
        ref: input.ref as ResourceRef,
        child: input.child,
        tenant: input.tenant,
        revealPii: true,
        limit: 500,
      });
      const row = (result.rows ?? []).find(
        (r) => String(r.id ?? r.Id) === input.id,
      );
      if (!row) return fail("StoreNotFound", { ref: input.ref });
      fx.log.info("console.store.reveal", {
        operatorId: fx.operator.id,
        ref: input.ref,
        child: input.child,
        id: input.id,
        column: input.column,
        tenant: input.tenant,
      });
      return {
        ok: true as const,
        value: row[input.column],
        at: state.now(),
      };
    },
  });
}

function createStoreEdit(state: ConsoleState) {
  return flow({
    name: "console.store.edit",
    unit: "console",
    plane: "operator",
    in: StoreEditIn,
    out: StoreEditOut,
    errors: { AuthFailed, TenantRequired, ConfirmRequired, StoreNotFound },
    do: async (input: z.infer<typeof StoreEditIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const tenantFail = requireTenantIfDeclared(state, input.tenant);
      if (tenantFail) return tenantFail;

      if (!input.commit) {
        // Return will-not-fire payload without applying — informational confirm.
        const preview = await state.editStore(
          {
            ref: input.ref as ResourceRef,
            child: input.child,
            tenant: input.tenant,
            id: input.id,
            key: input.key,
            patch: input.patch,
          },
          { dryRun: true },
        );
        return {
          ok: true as const,
          dryRun: true,
          applied: false,
          willNotFire: preview.willNotFire,
          wouldHaveFired: [...preview.wouldHaveFired],
          at: state.now(),
        };
      }

      if (state.production) {
        if (
          input.confirmation !== "EDIT" ||
          (input.reason?.trim().length ?? 0) < 3
        ) {
          return fail("ConfirmRequired", {
            phrase: "EDIT" as const,
            reason:
              "direct edit is not a flow execution — typed confirmation required",
          });
        }
      }

      const result = await state.editStore(
        {
          ref: input.ref as ResourceRef,
          child: input.child,
          tenant: input.tenant,
          id: input.id,
          key: input.key,
          patch: input.patch,
        },
        { dryRun: false },
      );
      fx.log.info("console.store.edit", {
        operatorId: fx.operator.id,
        ref: input.ref,
        child: input.child,
        willNotFire: result.willNotFire,
        reason: input.reason,
      });
      return {
        ok: true as const,
        dryRun: false,
        applied: result.applied,
        willNotFire: result.willNotFire,
        wouldHaveFired: [...result.wouldHaveFired],
        at: state.now(),
      };
    },
  });
}

function createStoreDelete(state: ConsoleState) {
  return flow({
    name: "console.store.delete",
    unit: "console",
    plane: "operator",
    in: StoreDeleteIn,
    out: StoreDeleteOut,
    errors: { AuthFailed, TenantRequired, ConfirmRequired },
    do: async (input: z.infer<typeof StoreDeleteIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const tenantFail = requireTenantIfDeclared(state, input.tenant);
      if (tenantFail) return tenantFail;
      if (state.production) {
        if (
          input.confirmation !== "DELETE" ||
          (input.reason?.trim().length ?? 0) < 3
        ) {
          return fail("ConfirmRequired", {
            phrase: "DELETE" as const,
            reason: "destructive store delete requires typed confirmation",
          });
        }
      }
      const result = await state.deleteStore({
        ref: input.ref as ResourceRef,
        child: input.child,
        tenant: input.tenant,
        ids: input.ids,
        keys: input.keys,
      });
      fx.log.info("console.store.delete", {
        operatorId: fx.operator.id,
        ref: input.ref,
        deleted: result.deleted,
        reason: input.reason,
      });
      return {
        ok: true as const,
        deleted: result.deleted,
        at: state.now(),
      };
    },
  });
}

function createStorePurgeCache(state: ConsoleState) {
  return flow({
    name: "console.store.purgeCache",
    unit: "console",
    plane: "operator",
    in: StorePurgeIn,
    out: StorePurgeOut,
    errors: { AuthFailed, ConfirmRequired },
    do: async (input: z.infer<typeof StorePurgeIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      if (state.production) {
        if (
          input.confirmation !== "PURGE" ||
          (input.reason?.trim().length ?? 0) < 3
        ) {
          return fail("ConfirmRequired", {
            phrase: "PURGE" as const,
            reason: "cache purge requires typed confirmation",
          });
        }
      }
      const result = await state.purgeStoreCache(input.resource as ResourceRef);
      fx.log.info("console.store.purgeCache", {
        operatorId: fx.operator.id,
        resource: input.resource,
        keys: result.keys,
        reason: input.reason,
      });
      return {
        ok: true as const,
        keys: [...result.keys],
        at: state.now(),
      };
    },
  });
}

function createStoreSql(state: ConsoleState) {
  return flow({
    name: "console.store.sql",
    unit: "console",
    plane: "operator",
    in: StoreSqlIn,
    out: StoreSqlOut,
    errors: { AuthFailed, TenantRequired, StoreNotFound },
    do: async (input: z.infer<typeof StoreSqlIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const tenantFail = requireTenantIfDeclared(state, input.tenant);
      if (tenantFail) return tenantFail;
      try {
        const result = await state.runStoreSql(
          input.ref as ResourceRef,
          input.sql,
          {
            allowWrite: input.allowWrite === true,
            tenant: input.tenant,
          },
        );
        fx.log.info("console.store.sql", {
          operatorId: fx.operator.id,
          ref: input.ref,
          allowWrite: input.allowWrite === true,
          rowCount: result.rows.length,
        });
        return result;
      } catch (err) {
        return fail("StoreNotFound", {
          ref: `${input.ref}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
  });
}

function createStorePreview(state: ConsoleState) {
  return flow({
    name: "console.store.preview",
    unit: "console",
    plane: "operator",
    in: StorePreviewIn,
    out: StorePreviewOut,
    errors: { AuthFailed, TenantRequired, DryRunUnsafe },
    do: async (input: z.infer<typeof StorePreviewIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const tenantFail = requireTenantIfDeclared(state, input.tenant);
      if (tenantFail) return tenantFail;
      try {
        const preview = await state.editStore(
          {
            ref: input.ref as ResourceRef,
            child: input.child,
            tenant: input.tenant,
            id: input.id,
            key: input.key,
            patch: input.patch,
          },
          { dryRun: true },
        );
        fx.log.info("console.store.preview", {
          operatorId: fx.operator.id,
          ref: input.ref,
          willNotFire: preview.willNotFire,
        });
        return {
          ok: true as const,
          dryRun: true as const,
          willNotFire: preview.willNotFire,
          wouldHaveFired: [...preview.wouldHaveFired],
          at: state.now(),
        };
      } catch (err) {
        if (err instanceof DryRunWriteIsolationError) {
          return fail("DryRunUnsafe", {
            ref: input.ref,
            reason: err.message,
          });
        }
        return fail("DryRunUnsafe", {
          ref: input.ref,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });
}
