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
  scopesForRoles,
  userPrincipal,
  type IssuedSession,
} from "../../auth/index.ts";
import { DryRunWriteIsolationError } from "../../kernel/dry-run.ts";
import { fail, flow, http, type AnyFlowDef, type Binding } from "../../kernel/index.ts";
import type { Flow as ManifestFlow, ResourceRef } from "../../manifest/types.ts";
import type { WideEvent } from "../../runs/types.ts";
import { bindHttp } from "./bind.ts";
import { touchLoginRateLimit } from "./auth-rate.ts";
import { verifyClaimCode } from "./claim.ts";
import {
  maskWideEventForConsole,
  piiFieldNamesFromManifest,
} from "./runs-pii.ts";
import {
  ClockResourceNotFoundError,
  ScheduleNotOverridableError,
} from "./clock.ts";
import { createFileDiff, emitStructuralDiff } from "./structural.ts";
import type { ConsoleState } from "./state.ts";
import { PUBLIC_CONSOLE_FLOWS } from "./public-flows.ts";
import { tenancyDeclared } from "./store.ts";

export { PUBLIC_CONSOLE_FLOWS };

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
const AuthRateLimited = z.object({ reason: z.string() });
const NotFound = z.object({ flowId: z.string() });
const InvokeDenied = z.object({ reason: z.string() });
const ConfirmRequired = z.object({
  phrase: z.enum([
    "INVOKE",
    "REPLAY",
    "DISCARD",
    "EDIT",
    "DELETE",
    "PURGE",
    "SET",
    "ROTATE",
    "REVOKE",
    "RUN",
    "SEND",
  ]),
  reason: z.string(),
});

const ChannelNotFound = z.object({ template: z.string() });

const ChannelOutcomeOut = z.object({
  state: z.enum([
    "suppressed/opted-out",
    "suppressed/prior-bounce",
    "blocked/invalid-address",
    "soft-bounce",
    "hard-bounce",
    "provider-error",
    "delivered-then-complained",
  ]),
  count: z.number(),
  verdict: z.enum(["correct", "retry", "suppress", "review"]),
  weight: z.number(),
});

const ChannelsListOut = z.object({
  face: z.enum(["inbox", "deliverability"]),
  production: z.boolean(),
  templates: z.array(
    z.object({
      name: z.string(),
      medium: z.string(),
      locales: z.array(z.string()),
      from: z.string().nullable(),
      schema: z.unknown(),
    }),
  ),
  outcomes: z.array(ChannelOutcomeOut),
  fallback: z.object({
    template: z.string().nullable(),
    chainExample: z.string(),
    fallbackRate: z.number(),
    fallbackCount: z.number(),
    totalCount: z.number(),
    weeklyDeltaUsd: z.number(),
    primaryMedium: z.string(),
    fallbackMedium: z.string(),
    summary: z.string(),
  }),
  inbox: z.array(
    z.object({
      id: z.string(),
      medium: z.string(),
      toMasked: z.string(),
      subject: z.string().nullable(),
      text: z.string().nullable(),
      html: z.string().nullable(),
      template: z.string().nullable(),
      locale: z.string().nullable(),
      at: z.number(),
    }),
  ),
  receipts: z.array(
    z.object({
      id: z.string(),
      template: z.string(),
      toMasked: z.string(),
      medium: z.string(),
      locale: z.string().nullable(),
      localeChain: z.array(z.string()),
      status: z.string(),
      chain: z.string(),
      messageId: z.string().nullable(),
      at: z.number(),
      error: z.string().nullable(),
    }),
  ),
  suppression: z.array(
    z.object({
      subjectMasked: z.string(),
      medium: z.string(),
      reason: z.enum(["opted-out", "prior-bounce"]),
      at: z.number(),
    }),
  ),
});

const ChannelPreviewIn = z.object({
  template: z.string().min(1),
  locale: z.string().optional(),
  profileLocale: z.string().optional(),
  acceptLanguage: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const ChannelPreviewOut = z.object({
  template: z.string(),
  locale: z.string(),
  localeChain: z.array(z.string()),
  dir: z.enum(["ltr", "rtl"]),
  subject: z.string().nullable(),
  text: z.string().nullable(),
  html: z.string().nullable(),
});

const ChannelVerifyAuthIn = z.object({
  from: z.string().min(1),
});

const ChannelVerifyAuthOut = z.object({
  domain: z.string(),
  spf: z.enum(["pass", "fail", "missing"]),
  dkim: z.enum(["pass", "fail", "missing"]),
  dmarc: z.enum(["pass", "fail", "missing"]),
  checkedAt: z.number(),
});

const ChannelRevealIn = z.object({
  id: z.string().min(1),
});

const ChannelRevealOut = z.object({
  ok: z.literal(true),
  id: z.string(),
  to: z.string(),
  at: z.number(),
});

const ChannelSendTestIn = z.object({
  template: z.string().min(1),
  to: z.string().min(1),
  locale: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  confirmation: z.string().optional(),
  reason: z.string().optional(),
});

const ChannelSendTestOut = z.object({
  ok: z.boolean(),
  messageId: z.string(),
  status: z.string(),
  chain: z.string(),
  at: z.number(),
});

const VaultNotFound = z.object({ name: z.string() });
const ClockNotFound = z.object({ kind: z.enum(["cron", "run"]), id: z.string() });
const ScheduleNotOverridable = z.object({ name: z.string() });

const CronHealthOut = z.object({
  driftMs: z.number().nullable(),
  overdue: z.boolean(),
  missedRuns: z.number(),
  catchUp: z.literal("one"),
  leaderInstanceId: z.string().optional(),
  leaderLeaseUntil: z.number().optional(),
});

const ClockCronOut = z.object({
  name: z.string(),
  status: z.enum(["active", "paused", "orphaned"]),
  timezone: z.string(),
  overridable: z.boolean(),
  declaredCron: z.string().optional(),
  declaredEvery: z.string().optional(),
  effectiveCron: z.string().optional(),
  effectiveEvery: z.string().optional(),
  lastRunAt: z.number().optional(),
  nextRunAt: z.number().optional(),
  health: CronHealthOut,
  dstAmbiguity: z
    .object({
      kind: z.enum(["gap", "overlap"]),
      reason: z.string(),
      on: z.string(),
      localTime: z.string(),
    })
    .nullable(),
  external: z.boolean(),
  flowIds: z.array(z.string()),
});

const WaitingOnOut = z.object({
  runId: z.string(),
  flow: z.string(),
  label: z.string(),
  wakeAt: z.number(),
  wakeInMs: z.number(),
  step: z.string().nullable(),
});

const ClockListOut = z.object({
  now: z.number(),
  crons: z.array(ClockCronOut),
  waitingOn: z.array(WaitingOnOut),
  waitingOnCounts: z.array(
    z.object({ label: z.string(), count: z.number() }),
  ),
  timeline: z.array(
    z.object({
      at: z.number(),
      kind: z.enum(["cron", "wake"]),
      name: z.string(),
      meta: z.string().optional(),
    }),
  ),
});

const ClockRunNowIn = z.object({
  name: z.string().min(1),
  confirmation: z.string().optional(),
  reason: z.string().optional(),
});

const ClockRunNowOut = z.object({
  ok: z.literal(true),
  name: z.string(),
  ran: z.boolean(),
  at: z.number(),
});

const ClockPauseIn = z.object({ name: z.string().min(1) });
const ClockPauseOut = z.object({
  ok: z.literal(true),
  name: z.string(),
  status: z.string(),
  at: z.number(),
});

const ClockEditIn = z.object({
  name: z.string().min(1),
  cron: z.string().optional(),
  every: z.string().optional(),
});

const ClockEditOut = z.object({
  ok: z.literal(true),
  name: z.string(),
  effectiveCron: z.string().optional(),
  effectiveEvery: z.string().optional(),
  at: z.number(),
});

const ClockWakeEarlyIn = z.object({ runId: z.string().min(1) });
const ClockWakeEarlyOut = z.object({
  ok: z.literal(true),
  runId: z.string(),
  wakeAt: z.number(),
  resumed: z.boolean(),
  at: z.number(),
});

const VaultResolutionStepOut = z.object({
  source: z.enum([
    "process.env",
    ".env.local",
    ".env.stack",
    "driver",
    "dev-fallback",
  ]),
  present: z.boolean(),
  won: z.boolean(),
});

const VaultBlastRadiusOut = z.object({
  count: z.number(),
  longestWakeAt: z.number().nullable(),
  longestOutstandingMs: z.number().nullable(),
  runIds: z.array(z.string()),
});

const VaultRowOut = z.object({
  name: z.string(),
  kind: z.enum(["secret", "config"]),
  sensitive: z.boolean(),
  description: z.string().optional(),
  rotate: z.string().optional(),
  fingerprints: z.record(z.string(), z.string()),
  fingerprint: z.string().nullable(),
  cleartext: z.string().nullable(),
  winner: z
    .enum([
      "process.env",
      ".env.local",
      ".env.stack",
      "driver",
      "dev-fallback",
    ])
    .nullable(),
  resolution: z.array(VaultResolutionStepOut),
  readers: z.array(z.string()),
  blastRadius: VaultBlastRadiusOut,
  lastReadAt: z.number().nullable(),
  sharedFingerprintEnvs: z.array(z.string()),
});

const VaultListOut = z.object({
  secrets: z.array(VaultRowOut),
  env: z.string(),
});

const VaultWriteIn = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  confirmation: z.string().optional(),
  reason: z.string().optional(),
});

const VaultWriteOut = z.object({
  ok: z.literal(true),
  name: z.string(),
  fingerprint: z.string().nullable(),
  at: z.number(),
});

const AiMetricOut = z.object({
  samples: z.array(z.number()),
  mean: z.number(),
  p50: z.number(),
  p95: z.number(),
  buckets: z.array(
    z.object({
      min: z.number(),
      max: z.number(),
      count: z.number(),
    }),
  ),
});

const AiListOut = z.object({
  prompts: z.array(
    z.object({
      name: z.string(),
      version: z.number().optional(),
      model: z.string().optional(),
      evals: z.string().optional(),
      budgetMaxCostPerCall: z.number().nullable(),
      manifestDiffPath: z.string(),
    }),
  ),
  agents: z.array(
    z.object({
      name: z.string(),
      tools: z.array(z.string()),
      maxSteps: z.number().optional(),
      model: z.string().optional(),
      budgetMaxCostPerRun: z.number().nullable(),
    }),
  ),
  versions: z.array(
    z.object({
      prompt: z.string(),
      version: z.number(),
      sampleCount: z.number(),
      cost: AiMetricOut,
      latencyMs: AiMetricOut,
      evalScore: AiMetricOut,
      schemaInvalidRate: z.number(),
      providerErrorRate: z.number(),
      okRate: z.number(),
      overBudgetRate: z.number(),
      budgetMaxCostPerCall: z.number().nullable(),
      outcomeCounts: z.object({
        ok: z.number(),
        provider_error: z.number(),
        schema_invalid: z.number(),
      }),
    }),
  ),
  allowPii: z.array(
    z.object({
      flowId: z.string(),
      asks: z.array(z.string()),
      pii: z.enum(["masked", "allow", "denied"]).nullable(),
      allowPii: z.boolean(),
      source: z.string().nullable(),
    }),
  ),
  fallbackChains: z.array(
    z.object({
      prompt: z.string(),
      version: z.number().optional(),
      attempts: z.array(
        z.object({
          model: z.string(),
          ok: z.boolean(),
          error: z.string().optional(),
          cost: z.number().optional(),
          latencyMs: z.number().optional(),
          at: z.number(),
        }),
      ),
      actualCost: z.number(),
      primaryOnlyCost: z.number().nullable(),
      costConsequence: z.number().nullable(),
      at: z.number(),
    }),
  ),
  agentRuns: z.array(
    z.object({
      id: z.string(),
      agent: z.string(),
      message: z.string(),
      ok: z.boolean(),
      steps: z.number(),
      cost: z.number(),
      at: z.number(),
      trail: z.array(
        z.object({
          tool: z.string(),
          status: z.enum(["ok", "denied"]),
          effects: z.array(
            z.object({
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
            }),
          ),
          denial: z
            .object({
              agent: z.string(),
              tool: z.string(),
              gate: z.string(),
              reason: z.string(),
              at: z.number(),
            })
            .nullable(),
          at: z.number(),
        }),
      ),
      denials: z.array(
        z.object({
          agent: z.string(),
          tool: z.string(),
          gate: z.string(),
          reason: z.string(),
          at: z.number(),
        }),
      ),
    }),
  ),
  denials: z.array(
    z.object({
      agent: z.string(),
      tool: z.string(),
      gate: z.string(),
      reason: z.string(),
      at: z.number(),
    }),
  ),
});

const GatesListOut = z.object({
  moduleActions: z.array(z.string()),
  flows: z.array(
    z.object({
      flowId: z.string(),
      plane: z.enum(["user", "operator"]),
      gates: z.array(z.string()),
      unguarded: z.boolean(),
    }),
  ),
  gates: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["policy", "rate"]),
      scopes: z.array(z.string()),
      roles: z.array(z.string()),
      strategy: z.string().optional(),
      max: z.number().optional(),
      per: z.string().optional(),
      keyBy: z.string().optional(),
      overridable: z.boolean(),
      attachedTo: z.array(z.string()),
    }),
  ),
  principals: z.array(
    z.object({
      kind: z.enum(["role", "key", "user"]),
      id: z.string(),
      name: z.string(),
      plane: z.enum(["user", "operator"]),
      scopes: z.array(z.string()),
      memberCount: z.number().optional(),
      email: z.string().optional(),
    }),
  ),
  violations: z.array(
    z.object({
      kind: z.literal("operator-application-scope"),
      operatorId: z.string(),
      name: z.string(),
      email: z.string(),
      applicationScopes: z.array(z.string()),
    }),
  ),
  audit: z.object({
    unguardedFlows: z.array(z.string()),
    orphanPermissions: z.array(z.string()),
    emptyRoles: z.array(z.string()),
    unattachedGates: z.array(z.string()),
  }),
  widenings: z.array(
    z.object({
      path: z.string(),
      category: z.string(),
      kind: z.string(),
      summary: z.string(),
      before: z.unknown().optional(),
      after: z.unknown().optional(),
    }),
  ),
});

const DiffChangeOut = z.object({
  path: z.string(),
  category: z.enum([
    "contract-breaking",
    "permission-widening",
    "effect-widening",
    "no-impact",
  ]),
  kind: z.enum(["added", "removed", "changed"]),
  summary: z.string(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  flowName: z.string().nullable(),
  runCountLastWeek: z.number(),
  blastLine: z.string().nullable(),
  weeklyDeltaUsd: z.number().nullable(),
  weeklyBillLine: z.string().nullable(),
  ciGate: z.enum(["blocked", "acknowledged"]).nullable(),
});

const DiffListOut = z.object({
  hasBaseline: z.boolean(),
  severity: z
    .enum([
      "contract-breaking",
      "permission-widening",
      "effect-widening",
      "no-impact",
    ])
    .nullable(),
  blockedCount: z.number(),
  acknowledgedCount: z.number(),
  changes: z.array(DiffChangeOut),
});

const SupplySignalStates = z.enum([
  "pass",
  "fail",
  "hold",
  "not-applicable",
  "unknown",
  "clean",
  "conflict",
]);

const PluginsListOut = z.object({
  stateDerivation: z.string(),
  plugins: z.array(
    z.object({
      id: z.string(),
      origin: z.enum(["core", "local", "community"]),
      state: z.enum(["on", "off"]),
      version: z.string().nullable(),
      summary: z.string().nullable(),
      scopes: z.array(
        z.object({
          kind: z.enum(["app", "unit", "flow"]),
          name: z.string().optional(),
        }),
      ),
      declares: z.array(z.string()),
      intercepts: z.array(
        z.object({
          stage: z.string(),
          meanMs: z.number().nullable(),
          count: z.number(),
        }),
      ),
      hookCost: z
        .object({
          count: z.number(),
          meanMs: z.number(),
          p50Ms: z.number(),
          p95Ms: z.number(),
          lastMs: z.number().nullable(),
        })
        .nullable(),
      supplyChain: z.object({
        lifecycleScripts: z.object({
          state: SupplySignalStates,
          scripts: z.array(z.string()),
          detail: z.string(),
        }),
        releaseCooldown: z.object({
          state: SupplySignalStates,
          publishedAt: z.number().nullable(),
          holdUntil: z.number().nullable(),
          detail: z.string(),
        }),
        nodeImportScan: z.object({
          state: SupplySignalStates,
          findings: z.array(
            z.object({
              source: z.string(),
              specifier: z.string(),
              line: z.number().nullable(),
            }),
          ),
          detail: z.string(),
        }),
        npmProvenance: z.object({
          state: SupplySignalStates,
          detail: z.string(),
        }),
        bootConflicts: z.object({
          state: SupplySignalStates,
          conflicts: z.array(z.string()),
          detail: z.string(),
        }),
      }),
      capabilityDiff: z.array(
        z.object({
          path: z.string(),
          category: z.string(),
          kind: z.string(),
          summary: z.string(),
        }),
      ),
      installCommand: z.string().nullable(),
      enableHint: z.string().nullable(),
      packageName: z.string().nullable(),
    }),
  ),
});

const GatesSimulateIn = z.object({
  flowId: z.string().min(1),
  principal: z.object({
    kind: z.enum(["role", "key", "user"]),
    id: z.string().min(1),
  }),
  meta: z
    .object({
      ip: z.string().optional(),
    })
    .optional(),
});

const GatesSimulateOut = z.object({
  flowId: z.string(),
  gates: z.array(z.string()),
  evaluations: z.array(
    z.object({
      name: z.string(),
      allowed: z.boolean(),
      kind: z.enum(["policy", "rate"]),
      remaining: z.number().optional(),
      retryAfterMs: z.number().optional(),
      reason: z.string().optional(),
    }),
  ),
  deniedAt: z.string().nullable(),
  denial: z
    .object({
      code: z.enum(["Unauthorized", "Forbidden", "RateLimited"]),
      data: z.record(z.string(), z.unknown()),
      status: z.union([z.literal(401), z.literal(403), z.literal(429)]),
    })
    .nullable(),
  allowed: z.boolean(),
});

const GatesPowersIn = z.object({
  kind: z.enum(["role", "key", "user"]),
  id: z.string().min(1),
});

const GatesPowersOut = z.object({
  scopes: z.array(z.string()),
  allowedFlowIds: z.array(z.string()),
  deniedFlowIds: z.array(z.string()),
});

const AccessPlaneSection = z.object({
  plane: z.enum(["user", "operator"]),
  operators: z
    .array(
      z.object({
        id: z.string(),
        email: z.string(),
        name: z.string(),
        status: z.enum(["active", "suspended", "invited"]),
        roles: z.array(z.string()),
        scopes: z.array(z.string()),
        lastSeenAt: z.number().nullable(),
        neverSignedIn: z.boolean(),
      }),
    )
    .optional(),
  users: z
    .array(
      z.object({
        id: z.string(),
        email: z.string(),
        name: z.string(),
        status: z.enum(["active", "disabled"]),
        roles: z.array(z.string()),
        scopes: z.array(z.string()),
      }),
    )
    .optional(),
  roles: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      plane: z.enum(["user", "operator"]),
      description: z.string(),
      scopes: z.array(z.string()),
      memberCount: z.number(),
    }),
  ),
  keys: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      plane: z.enum(["user", "operator"]),
      scopes: z.array(z.string()),
      createdAt: z.number(),
      lastUsedAt: z.number().nullable(),
      expiresAt: z.number().nullable(),
      revokedAt: z.number().nullable(),
      rateLimit: z
        .object({ max: z.number(), per: z.string() })
        .nullable(),
      ipAllowlist: z.array(z.string()),
      unused90d: z.boolean(),
    }),
  ),
  invites: z
    .array(
      z.object({
        id: z.string(),
        email: z.string(),
        invitedBy: z.string(),
        createdAt: z.number(),
        expiresAt: z.number(),
        expired: z.boolean(),
      }),
    )
    .optional(),
  grantableScopes: z.array(z.string()),
});

const AccessListOut = z.object({
  operatorPlane: AccessPlaneSection,
  userPlane: AccessPlaneSection,
  hygiene: z.object({
    unusedKeys: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        plane: z.enum(["user", "operator"]),
        scopes: z.array(z.string()),
        createdAt: z.number(),
        lastUsedAt: z.number().nullable(),
        expiresAt: z.number().nullable(),
        revokedAt: z.number().nullable(),
        rateLimit: z
          .object({ max: z.number(), per: z.string() })
          .nullable(),
        ipAllowlist: z.array(z.string()),
        unused90d: z.boolean(),
      }),
    ),
    neverSignedInOperators: z.array(
      z.object({
        id: z.string(),
        email: z.string(),
        name: z.string(),
        status: z.enum(["active", "suspended", "invited"]),
        roles: z.array(z.string()),
        scopes: z.array(z.string()),
        lastSeenAt: z.number().nullable(),
        neverSignedIn: z.boolean(),
      }),
    ),
    expiredInvitations: z.array(
      z.object({
        id: z.string(),
        email: z.string(),
        invitedBy: z.string(),
        createdAt: z.number(),
        expiresAt: z.number(),
        expired: z.boolean(),
      }),
    ),
  }),
  accessTtlMs: z.number(),
  catalog: z.array(z.string()),
});

const AccessEffectiveIn = z.object({
  kind: z.enum(["operator", "user", "role", "key"]),
  id: z.string().min(1),
});

const AccessEffectiveOut = z.object({
  kind: z.enum(["operator", "user", "role", "key"]),
  id: z.string(),
  plane: z.enum(["user", "operator"]),
  scopes: z.array(
    z.object({
      scope: z.string(),
      sources: z.array(
        z.object({
          kind: z.enum(["role", "direct"]),
          id: z.string(),
          name: z.string(),
        }),
      ),
    }),
  ),
});

const AccessKeyBlastIn = z.object({
  keyId: z.string().min(1),
});

const AccessKeyBlastOut = z.object({
  callVolume: z.number(),
  lastUsedAt: z.number().nullable(),
  sourceAddresses: z.array(z.string()),
  accessTtlMs: z.number(),
  residualAccessNote: z.string(),
});

const AccessCreateKeyIn = z.object({
  plane: z.enum(["user", "operator"]),
  name: z.string().min(1),
  scopes: z.array(z.string()),
  expiresAt: z.number().nullable().optional(),
  rateLimit: z
    .object({ max: z.number(), per: z.string() })
    .nullable()
    .optional(),
  ipAllowlist: z.array(z.string()).optional(),
});

const AccessCreateKeyOut = z.object({
  key: z.object({
    id: z.string(),
    name: z.string(),
    plane: z.enum(["user", "operator"]),
    scopes: z.array(z.string()),
    createdAt: z.number(),
    lastUsedAt: z.number().nullable(),
    expiresAt: z.number().nullable(),
    revokedAt: z.number().nullable(),
    rateLimit: z.object({ max: z.number(), per: z.string() }).nullable(),
    ipAllowlist: z.array(z.string()),
    unused90d: z.boolean(),
  }),
  /** Raw secret — returned exactly once. */
  secret: z.string(),
});

const AccessRevokeKeyIn = z.object({
  keyId: z.string().min(1),
  confirmation: z.string().optional(),
  reason: z.string().optional(),
});

const AccessRevokeKeyOut = z.object({
  key: z.object({
    id: z.string(),
    name: z.string(),
    plane: z.enum(["user", "operator"]),
    scopes: z.array(z.string()),
    createdAt: z.number(),
    lastUsedAt: z.number().nullable(),
    expiresAt: z.number().nullable(),
    revokedAt: z.number().nullable(),
    rateLimit: z.object({ max: z.number(), per: z.string() }).nullable(),
    ipAllowlist: z.array(z.string()),
    unused90d: z.boolean(),
  }),
  blastRadius: AccessKeyBlastOut,
});

const AccessRotateKeyIn = z.object({
  keyId: z.string().min(1),
  confirmation: z.string().optional(),
  reason: z.string().optional(),
});

const AccessRotateKeyOut = z.object({
  key: AccessCreateKeyOut.shape.key,
  secret: z.string(),
  blastRadius: AccessKeyBlastOut,
});

const AccessSetRoleGrantsIn = z.object({
  roleId: z.string().min(1),
  scopes: z.array(z.string()),
});

const AccessSetRoleGrantsOut = z.object({
  roleId: z.string(),
  scopes: z.array(z.string()),
});

const AccessGrantDenied = z.object({ reason: z.string() });
const AccessKeyNotFound = z.object({ keyId: z.string() });

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
      readonly status: AnyFlowDef;
      readonly claim: AnyFlowDef;
    };
    readonly session: {
      readonly login: AnyFlowDef;
      readonly me: AnyFlowDef;
      readonly logout: AnyFlowDef;
    };
    readonly manifest: { readonly get: AnyFlowDef };
    readonly runs: { readonly list: AnyFlowDef };
    readonly action: { readonly ping: AnyFlowDef };
    readonly structural: {
      readonly propose: AnyFlowDef;
    };
    readonly flows: {
      readonly identities: AnyFlowDef;
      readonly invoke: AnyFlowDef;
    };
    readonly traces: {
      readonly replay: AnyFlowDef;
    };
    readonly signals: {
      readonly list: AnyFlowDef;
      readonly replay: AnyFlowDef;
      readonly dryRunReplay: AnyFlowDef;
      readonly discard: AnyFlowDef;
    };
    readonly store: {
      readonly list: AnyFlowDef;
      readonly query: AnyFlowDef;
      readonly reveal: AnyFlowDef;
      readonly edit: AnyFlowDef;
      readonly delete: AnyFlowDef;
      readonly purgeCache: AnyFlowDef;
      readonly sql: AnyFlowDef;
      readonly preview: AnyFlowDef;
    };
    readonly vault: {
      readonly list: AnyFlowDef;
      readonly set: AnyFlowDef;
      readonly rotate: AnyFlowDef;
    };
    readonly ai: {
      readonly list: AnyFlowDef;
    };
    readonly gates: {
      readonly list: AnyFlowDef;
      readonly simulate: AnyFlowDef;
      readonly powers: AnyFlowDef;
    };
    readonly access: {
      readonly list: AnyFlowDef;
      readonly effective: AnyFlowDef;
      readonly keyBlast: AnyFlowDef;
      readonly createKey: AnyFlowDef;
      readonly revokeKey: AnyFlowDef;
      readonly rotateKey: AnyFlowDef;
      readonly setRoleGrants: AnyFlowDef;
    };
    readonly diff: {
      readonly list: AnyFlowDef;
    };
    readonly plugin: {
      readonly list: AnyFlowDef;
    };
    readonly clock: {
      readonly list: AnyFlowDef;
      readonly runNow: AnyFlowDef;
      readonly pause: AnyFlowDef;
      readonly editSchedule: AnyFlowDef;
      readonly wakeEarly: AnyFlowDef;
    };
    readonly channel: {
      readonly list: AnyFlowDef;
      readonly preview: AnyFlowDef;
      readonly verifyAuth: AnyFlowDef;
      readonly reveal: AnyFlowDef;
      readonly sendTest: AnyFlowDef;
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
  const vaultList = createVaultList(state);
  const vaultSet = createVaultSet(state);
  const vaultRotate = createVaultRotate(state);
  const aiList = createAiList(state);
  const gatesList = createGatesList(state);
  const gatesSimulate = createGatesSimulate(state);
  const gatesPowers = createGatesPowers(state);
  const accessList = createAccessList(state);
  const accessEffective = createAccessEffective(state);
  const accessKeyBlast = createAccessKeyBlast(state);
  const accessCreateKeyFlow = createAccessCreateKey(state);
  const accessRevokeKeyFlow = createAccessRevokeKey(state);
  const accessRotateKeyFlow = createAccessRotateKey(state);
  const accessSetRoleGrantsFlow = createAccessSetRoleGrants(state);
  const diffList = createDiffList(state);
  const pluginsList = createPluginsList(state);
  const clockList = createClockList(state);
  const clockRunNow = createClockRunNow(state);
  const clockPause = createClockPause(state);
  const clockEditSchedule = createClockEditSchedule(state);
  const clockWakeEarly = createClockWakeEarly(state);
  const channelsList = createChannelsList(state);
  const channelPreview = createChannelPreview(state);
  const channelVerifyAuth = createChannelVerifyAuth(state);
  const channelReveal = createChannelReveal(state);
  const channelSendTest = createChannelSendTest(state);

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
    bindHttp(http.get("/console/vault"), vaultList),
    bindHttp(http.post("/console/vault/set"), vaultSet),
    bindHttp(http.post("/console/vault/rotate"), vaultRotate),
    bindHttp(http.get("/console/ai"), aiList),
    bindHttp(http.get("/console/gates"), gatesList),
    bindHttp(http.post("/console/gates/simulate"), gatesSimulate),
    bindHttp(http.post("/console/gates/powers"), gatesPowers),
    bindHttp(http.get("/console/access"), accessList),
    bindHttp(http.post("/console/access/effective"), accessEffective),
    bindHttp(http.post("/console/access/key-blast"), accessKeyBlast),
    bindHttp(http.post("/console/access/keys"), accessCreateKeyFlow),
    bindHttp(http.post("/console/access/keys/revoke"), accessRevokeKeyFlow),
    bindHttp(http.post("/console/access/keys/rotate"), accessRotateKeyFlow),
    bindHttp(
      http.post("/console/access/roles/grants"),
      accessSetRoleGrantsFlow,
    ),
    bindHttp(http.get("/console/diff"), diffList),
    bindHttp(http.get("/console/plugins"), pluginsList),
    bindHttp(http.get("/console/clock"), clockList),
    bindHttp(http.post("/console/clock/run-now"), clockRunNow),
    bindHttp(http.post("/console/clock/pause"), clockPause),
    bindHttp(http.post("/console/clock/edit-schedule"), clockEditSchedule),
    bindHttp(http.post("/console/clock/wake-early"), clockWakeEarly),
    bindHttp(http.get("/console/channels"), channelsList),
    bindHttp(http.post("/console/channels/preview"), channelPreview),
    bindHttp(http.post("/console/channels/verify-auth"), channelVerifyAuth),
    bindHttp(http.post("/console/channels/reveal"), channelReveal),
    bindHttp(http.post("/console/channels/send-test"), channelSendTest),
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
      vault: {
        list: vaultList,
        set: vaultSet,
        rotate: vaultRotate,
      },
      ai: { list: aiList },
      gates: {
        list: gatesList,
        simulate: gatesSimulate,
        powers: gatesPowers,
      },
      access: {
        list: accessList,
        effective: accessEffective,
        keyBlast: accessKeyBlast,
        createKey: accessCreateKeyFlow,
        revokeKey: accessRevokeKeyFlow,
        rotateKey: accessRotateKeyFlow,
        setRoleGrants: accessSetRoleGrantsFlow,
      },
      diff: { list: diffList },
      plugin: { list: pluginsList },
      clock: {
        list: clockList,
        runNow: clockRunNow,
        pause: clockPause,
        editSchedule: clockEditSchedule,
        wakeEarly: clockWakeEarly,
      },
      channel: {
        list: channelsList,
        preview: channelPreview,
        verifyAuth: channelVerifyAuth,
        reveal: channelReveal,
        sendTest: channelSendTest,
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
      state.persistOperator(op.id);
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
    errors: { AuthFailed, AuthRateLimited },
    do: async (input: z.infer<typeof LoginIn>, fx) => {
      if (
        touchLoginRateLimit(state.loginAttempts, input.email, state.now()) ===
        "rate_limited"
      ) {
        return fail("AuthRateLimited", {
          reason: "too many login attempts; retry after 60s",
        });
      }
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
      const piiFields = piiFieldNamesFromManifest(state.manifest);
      return {
        runs: all.map((r) => projectRun(r, piiFields)),
      };
    },
  });
}

/**
 * Project a wide event for GET /console/runs (Runs · Traces · Overview).
 *
 * PII-classified fields are masked centrally here so every panel that reads
 * the shared wide-event store sees the same redaction as Store's row browser.
 *
 * @param r - Stored wide event
 * @param piiFields - Classified field names from the Manifest
 */
export function projectRun(
  r: WideEvent,
  piiFields: ReadonlySet<string> = new Set(),
) {
  const masked = maskWideEventForConsole(r, piiFields);
  const dimensions: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(masked.dimensions)) {
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
    error: masked.error?.code ?? null,
    sampled: masked.error ? ("error" as const) : ("sample" as const),
    effects: masked.effects.map((e) => ({
      kind: e.kind,
      resource: e.resource,
      timestamp: e.timestamp,
      duration: e.duration,
      reversibility: e.reversibility,
    })),
    logs: masked.logs.map((line) => ({
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
  const op = state.operators.operators.get(operatorId);
  if (op) op.lastSeenAt = state.now();
  return issueSession(
    state.sessions,
    {
      secret: state.secret,
      now: state.now,
      accessTtlMs: state.accessTtlMs,
    },
    {
      id: operatorId,
      plane: "operator",
      scopes: ["console:*"],
    },
  );
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

function createVaultList(state: ConsoleState) {
  return flow({
    name: "console.vault.list",
    unit: "console",
    plane: "operator",
    out: VaultListOut,
    errors: { AuthFailed },
    do: async (_input, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      return state.listVault();
    },
  });
}

function createVaultSet(state: ConsoleState) {
  return flow({
    name: "console.vault.set",
    unit: "console",
    plane: "operator",
    in: VaultWriteIn,
    out: VaultWriteOut,
    errors: { AuthFailed, VaultNotFound, ConfirmRequired },
    do: async (input: z.infer<typeof VaultWriteIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      if (!(await vaultNameKnown(state, input.name))) {
        return fail("VaultNotFound", { name: input.name });
      }
      if (state.production) {
        if (input.confirmation !== "SET" || !input.reason || input.reason.length < 3) {
          return fail("ConfirmRequired", {
            phrase: "SET" as const,
            reason: "Type SET and provide a reason to write a secret in production",
          });
        }
      }
      try {
        const result = await state.setVault({
          name: input.name,
          value: input.value,
        });
        // Never log the value — name + fingerprint only.
        fx.log.info("console.vault.set", {
          operatorId: fx.operator.id,
          name: result.name,
          fingerprint: result.fingerprint,
          reason: input.reason,
        });
        return {
          ok: true as const,
          name: result.name,
          fingerprint: result.fingerprint,
          at: state.now(),
        };
      } catch (err) {
        return fail("VaultNotFound", {
          name: `${input.name}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
  });
}

function createVaultRotate(state: ConsoleState) {
  return flow({
    name: "console.vault.rotate",
    unit: "console",
    plane: "operator",
    in: VaultWriteIn,
    out: VaultWriteOut,
    errors: { AuthFailed, VaultNotFound, ConfirmRequired },
    do: async (input: z.infer<typeof VaultWriteIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      if (!(await vaultNameKnown(state, input.name))) {
        return fail("VaultNotFound", { name: input.name });
      }
      // Rotate always requires typed confirm (console §6 · §9.8).
      if (
        input.confirmation !== "ROTATE" ||
        !input.reason ||
        input.reason.length < 3
      ) {
        return fail("ConfirmRequired", {
          phrase: "ROTATE" as const,
          reason:
            "Type ROTATE and provide a reason — in-flight durable runs may wake holding the new key",
        });
      }
      try {
        const result = await state.rotateVault({
          name: input.name,
          value: input.value,
        });
        fx.log.info("console.vault.rotate", {
          operatorId: fx.operator.id,
          name: result.name,
          fingerprint: result.fingerprint,
          reason: input.reason,
        });
        return {
          ok: true as const,
          name: result.name,
          fingerprint: result.fingerprint,
          at: state.now(),
        };
      } catch (err) {
        return fail("VaultNotFound", {
          name: `${input.name}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
  });
}

/**
 * Whether a vault contract name is known to Manifest or the live runtime.
 *
 * @param state - Console state
 * @param name - Contract name
 */
async function vaultNameKnown(
  state: ConsoleState,
  name: string,
): Promise<boolean> {
  if (state.manifest?.vault?.[name]) return true;
  if (state.vaultRuntime?.contracts.has(name)) return true;
  if (state.vaultRuntime?.names().includes(name)) return true;
  const listed = await state.listVault();
  return listed.secrets.some((s) => s.name === name);
}

function createAiList(state: ConsoleState) {
  return flow({
    name: "console.ai.list",
    unit: "console",
    plane: "operator",
    out: AiListOut,
    errors: { AuthFailed },
    do: async (_input, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const projection = await state.listAi();
      return {
        prompts: projection.prompts.map((p) => ({
          name: p.name,
          ...(p.version !== undefined ? { version: p.version } : {}),
          ...(p.model !== undefined ? { model: p.model } : {}),
          ...(p.evals !== undefined ? { evals: p.evals } : {}),
          budgetMaxCostPerCall: p.budgetMaxCostPerCall,
          manifestDiffPath: p.manifestDiffPath,
        })),
        agents: projection.agents.map((a) => ({
          name: a.name,
          tools: [...a.tools],
          ...(a.maxSteps !== undefined ? { maxSteps: a.maxSteps } : {}),
          ...(a.model !== undefined ? { model: a.model } : {}),
          budgetMaxCostPerRun: a.budgetMaxCostPerRun,
        })),
        versions: projection.versions.map((v) => ({
          ...v,
          outcomeCounts: { ...v.outcomeCounts },
        })),
        allowPii: projection.allowPii.map((r) => ({
          ...r,
          asks: [...r.asks],
        })),
        fallbackChains: projection.fallbackChains.map((c) => ({
          prompt: c.prompt,
          ...(c.version !== undefined ? { version: c.version } : {}),
          attempts: c.attempts.map((a) => ({ ...a })),
          actualCost: c.actualCost,
          primaryOnlyCost: c.primaryOnlyCost,
          costConsequence: c.costConsequence,
          at: c.at,
        })),
        agentRuns: projection.agentRuns.map((r) => ({
          ...r,
          trail: r.trail.map((t) => ({
            ...t,
            effects: t.effects.map((e) => ({ ...e })),
            denial: t.denial ? { ...t.denial } : null,
          })),
          denials: r.denials.map((d) => ({ ...d })),
        })),
        denials: projection.denials.map((d) => ({ ...d })),
      };
    },
  });
}

function createGatesList(state: ConsoleState) {
  return flow({
    name: "console.gates.list",
    unit: "console",
    plane: "operator",
    out: GatesListOut,
    errors: { AuthFailed },
    do: async (_input, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const projection = await state.listGates();
      return {
        moduleActions: [...projection.moduleActions],
        flows: projection.flows.map((f) => ({
          flowId: f.flowId,
          plane: f.plane,
          gates: [...f.gates],
          unguarded: f.unguarded,
        })),
        gates: projection.gates.map((g) => ({
          name: g.name,
          kind: g.kind,
          scopes: [...g.scopes],
          roles: [...g.roles],
          ...(g.strategy !== undefined ? { strategy: g.strategy } : {}),
          ...(g.max !== undefined ? { max: g.max } : {}),
          ...(g.per !== undefined ? { per: g.per } : {}),
          ...(g.keyBy !== undefined ? { keyBy: g.keyBy } : {}),
          overridable: g.overridable,
          attachedTo: [...g.attachedTo],
        })),
        principals: projection.principals.map((p) => ({
          kind: p.kind,
          id: p.id,
          name: p.name,
          plane: p.plane,
          scopes: [...p.scopes],
          ...(p.memberCount !== undefined
            ? { memberCount: p.memberCount }
            : {}),
          ...(p.email !== undefined ? { email: p.email } : {}),
        })),
        violations: projection.violations.map((v) => ({
          kind: v.kind,
          operatorId: v.operatorId,
          name: v.name,
          email: v.email,
          applicationScopes: [...v.applicationScopes],
        })),
        audit: {
          unguardedFlows: [...projection.audit.unguardedFlows],
          orphanPermissions: [...projection.audit.orphanPermissions],
          emptyRoles: [...projection.audit.emptyRoles],
          unattachedGates: [...projection.audit.unattachedGates],
        },
        widenings: projection.widenings.map((w) => ({
          path: w.path,
          category: w.category,
          kind: w.kind,
          summary: w.summary,
          ...(w.before !== undefined ? { before: w.before } : {}),
          ...(w.after !== undefined ? { after: w.after } : {}),
        })),
      };
    },
  });
}

function createDiffList(state: ConsoleState) {
  return flow({
    name: "console.diff.list",
    unit: "console",
    plane: "operator",
    out: DiffListOut,
    errors: { AuthFailed },
    do: async (_input, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const projection = await state.listDiff();
      return {
        hasBaseline: projection.hasBaseline,
        severity: projection.severity,
        blockedCount: projection.blockedCount,
        acknowledgedCount: projection.acknowledgedCount,
        changes: projection.changes.map((c) => ({
          path: c.path,
          category: c.category,
          kind: c.kind,
          summary: c.summary,
          ...(c.before !== undefined ? { before: c.before } : {}),
          ...(c.after !== undefined ? { after: c.after } : {}),
          flowName: c.flowName,
          runCountLastWeek: c.runCountLastWeek,
          blastLine: c.blastLine,
          weeklyDeltaUsd: c.weeklyDeltaUsd,
          weeklyBillLine: c.weeklyBillLine,
          ciGate: c.ciGate,
        })),
      };
    },
  });
}

function createPluginsList(state: ConsoleState) {
  return flow({
    name: "console.plugin.list",
    unit: "console",
    plane: "operator",
    out: PluginsListOut,
    errors: { AuthFailed },
    do: async (_input, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      return state.listPlugins();
    },
  });
}

function createGatesSimulate(state: ConsoleState) {
  return flow({
    name: "console.gates.simulate",
    unit: "console",
    plane: "operator",
    in: GatesSimulateIn,
    out: GatesSimulateOut,
    errors: { AuthFailed },
    do: async (input: z.infer<typeof GatesSimulateIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const result = await state.simulateGates(input);
      return {
        flowId: result.flowId,
        gates: [...result.gates],
        evaluations: result.evaluations.map((e) => ({
          name: e.name,
          allowed: e.allowed,
          kind: e.kind,
          ...(e.remaining !== undefined ? { remaining: e.remaining } : {}),
          ...(e.retryAfterMs !== undefined
            ? { retryAfterMs: e.retryAfterMs }
            : {}),
          ...(e.reason !== undefined ? { reason: e.reason } : {}),
        })),
        deniedAt: result.deniedAt,
        denial: result.denial
          ? {
              code: result.denial.code,
              data: { ...result.denial.data },
              status: result.denial.status,
            }
          : null,
        allowed: result.allowed,
      };
    },
  });
}

function createGatesPowers(state: ConsoleState) {
  return flow({
    name: "console.gates.powers",
    unit: "console",
    plane: "operator",
    in: GatesPowersIn,
    out: GatesPowersOut,
    errors: { AuthFailed },
    do: async (input: z.infer<typeof GatesPowersIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const result = await state.powersForPrincipal(input);
      return {
        scopes: [...result.scopes],
        allowedFlowIds: [...result.allowedFlowIds],
        deniedFlowIds: [...result.deniedFlowIds],
      };
    },
  });
}

/**
 * Actor grant ceiling — role scopes plus session `console:*`.
 *
 * @param state - Console state
 * @param operatorId - Acting operator
 */
function actorScopesOf(state: ConsoleState, operatorId: string): string[] {
  const roleIds = state.operators.roles.get(operatorId) ?? [];
  const fromRoles = [...scopesForRoles(state.roles, roleIds, "operator")];
  // Console sessions mint `console:*` (see issueOperatorSession).
  return [...new Set([...fromRoles, "console:*"])];
}

function createAccessList(state: ConsoleState) {
  return flow({
    name: "console.access.list",
    unit: "console",
    plane: "operator",
    out: AccessListOut,
    errors: { AuthFailed },
    do: async (_input, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      return state.listAccess(actorScopesOf(state, fx.operator.id));
    },
  });
}

function createAccessEffective(state: ConsoleState) {
  return flow({
    name: "console.access.effective",
    unit: "console",
    plane: "operator",
    in: AccessEffectiveIn,
    out: AccessEffectiveOut,
    errors: { AuthFailed, NotFound },
    do: async (input: z.infer<typeof AccessEffectiveIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const result = await state.accessEffective(input);
      if (!result) {
        return fail("NotFound", { flowId: `${input.kind}:${input.id}` });
      }
      return {
        kind: result.kind,
        id: result.id,
        plane: result.plane,
        scopes: result.scopes.map((s) => ({
          scope: s.scope,
          sources: s.sources.map((src) => ({ ...src })),
        })),
      };
    },
  });
}

function createAccessKeyBlast(state: ConsoleState) {
  return flow({
    name: "console.access.keyBlast",
    unit: "console",
    plane: "operator",
    in: AccessKeyBlastIn,
    out: AccessKeyBlastOut,
    errors: { AuthFailed, AccessKeyNotFound },
    do: async (input: z.infer<typeof AccessKeyBlastIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      if (!state.apiKeys.keys.has(input.keyId)) {
        return fail("AccessKeyNotFound", { keyId: input.keyId });
      }
      return state.accessKeyBlast(input.keyId);
    },
  });
}

function createAccessCreateKey(state: ConsoleState) {
  return flow({
    name: "console.access.createKey",
    unit: "console",
    plane: "operator",
    in: AccessCreateKeyIn,
    out: AccessCreateKeyOut,
    errors: { AuthFailed, AccessGrantDenied },
    do: async (input: z.infer<typeof AccessCreateKeyIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      try {
        const created = await state.accessCreateKey({
          plane: input.plane,
          name: input.name,
          scopes: input.scopes,
          creatorId: fx.operator.id,
          creatorScopes: actorScopesOf(state, fx.operator.id),
          expiresAt: input.expiresAt,
          rateLimit: input.rateLimit,
          ipAllowlist: input.ipAllowlist,
        });
        fx.log.info("console.access.createKey", {
          keyId: created.row.id,
          plane: created.row.plane,
          operatorId: fx.operator.id,
        });
        return { key: { ...created.row }, secret: created.secret };
      } catch (err) {
        return fail("AccessGrantDenied", {
          reason: err instanceof Error ? err.message : "grant denied",
        });
      }
    },
  });
}

function createAccessRevokeKey(state: ConsoleState) {
  return flow({
    name: "console.access.revokeKey",
    unit: "console",
    plane: "operator",
    in: AccessRevokeKeyIn,
    out: AccessRevokeKeyOut,
    errors: { AuthFailed, AccessKeyNotFound, ConfirmRequired },
    do: async (input: z.infer<typeof AccessRevokeKeyIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      if (
        input.confirmation !== "REVOKE" ||
        (input.reason?.trim().length ?? 0) < 3
      ) {
        return fail("ConfirmRequired", {
          phrase: "REVOKE" as const,
          reason:
            "Type REVOKE and provide a reason — revocation is irreversible",
        });
      }
      const blastRadius = await state.accessKeyBlast(input.keyId);
      const key = await state.accessRevokeKey(input.keyId);
      if (!key) {
        return fail("AccessKeyNotFound", { keyId: input.keyId });
      }
      fx.log.info("console.access.revokeKey", {
        keyId: key.id,
        operatorId: fx.operator.id,
        reason: input.reason,
        callVolume: blastRadius.callVolume,
      });
      return { key: { ...key }, blastRadius };
    },
  });
}

function createAccessRotateKey(state: ConsoleState) {
  return flow({
    name: "console.access.rotateKey",
    unit: "console",
    plane: "operator",
    in: AccessRotateKeyIn,
    out: AccessRotateKeyOut,
    errors: { AuthFailed, AccessKeyNotFound, ConfirmRequired },
    do: async (input: z.infer<typeof AccessRotateKeyIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      if (
        input.confirmation !== "ROTATE" ||
        (input.reason?.trim().length ?? 0) < 3
      ) {
        return fail("ConfirmRequired", {
          phrase: "ROTATE" as const,
          reason:
            "Type ROTATE and provide a reason — the old secret dies immediately",
        });
      }
      const blastRadius = await state.accessKeyBlast(input.keyId);
      const rotated = await state.accessRotateKey(input.keyId);
      if (!rotated) {
        return fail("AccessKeyNotFound", { keyId: input.keyId });
      }
      fx.log.info("console.access.rotateKey", {
        keyId: rotated.row.id,
        operatorId: fx.operator.id,
        reason: input.reason,
      });
      return {
        key: { ...rotated.row },
        secret: rotated.secret,
        blastRadius,
      };
    },
  });
}

function createAccessSetRoleGrants(state: ConsoleState) {
  return flow({
    name: "console.access.setRoleGrants",
    unit: "console",
    plane: "operator",
    in: AccessSetRoleGrantsIn,
    out: AccessSetRoleGrantsOut,
    errors: { AuthFailed, AccessGrantDenied },
    do: async (input: z.infer<typeof AccessSetRoleGrantsIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      try {
        await state.accessSetRoleGrants({
          roleId: input.roleId,
          scopes: input.scopes,
          actorScopes: actorScopesOf(state, fx.operator.id),
        });
        fx.log.info("console.access.setRoleGrants", {
          roleId: input.roleId,
          operatorId: fx.operator.id,
          scopes: input.scopes,
        });
        return { roleId: input.roleId, scopes: [...input.scopes] };
      } catch (err) {
        return fail("AccessGrantDenied", {
          reason: err instanceof Error ? err.message : "grant denied",
        });
      }
    },
  });
}

function createClockList(state: ConsoleState) {
  return flow({
    name: "console.clock.list",
    unit: "console",
    plane: "operator",
    out: ClockListOut,
    errors: { AuthFailed },
    do: async (_input, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      return state.listClocks();
    },
  });
}

function createClockRunNow(state: ConsoleState) {
  return flow({
    name: "console.clock.runNow",
    unit: "console",
    plane: "operator",
    in: ClockRunNowIn,
    out: ClockRunNowOut,
    errors: { AuthFailed, ClockNotFound, ConfirmRequired },
    do: async (input: z.infer<typeof ClockRunNowIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const list = await state.listClocks();
      const cron = list.crons.find((c) => c.name === input.name);
      if (!cron) {
        return fail("ClockNotFound", { kind: "cron" as const, id: input.name });
      }
      if (state.production && cron.external) {
        if (
          input.confirmation !== "RUN" ||
          !input.reason ||
          input.reason.length < 3
        ) {
          return fail("ConfirmRequired", {
            phrase: "RUN" as const,
            reason:
              "Type RUN and provide a reason — this cron has an external effect",
          });
        }
      }
      try {
        const result = await state.runCronNow(input.name);
        fx.log.info("console.clock.runNow", {
          operatorId: fx.operator.id,
          name: input.name,
          ran: result.ran,
          reason: input.reason,
        });
        return {
          ok: true as const,
          name: input.name,
          ran: result.ran,
          at: state.now(),
        };
      } catch (err) {
        if (err instanceof ClockResourceNotFoundError) {
          return fail("ClockNotFound", { kind: err.kind, id: err.id });
        }
        throw err;
      }
    },
  });
}

function createClockPause(state: ConsoleState) {
  return flow({
    name: "console.clock.pause",
    unit: "console",
    plane: "operator",
    in: ClockPauseIn,
    out: ClockPauseOut,
    errors: { AuthFailed, ClockNotFound },
    do: async (input: z.infer<typeof ClockPauseIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      try {
        const result = await state.pauseCron(input.name);
        fx.log.info("console.clock.pause", {
          operatorId: fx.operator.id,
          name: result.name,
        });
        return {
          ok: true as const,
          name: result.name,
          status: result.status,
          at: state.now(),
        };
      } catch (err) {
        if (err instanceof ClockResourceNotFoundError) {
          return fail("ClockNotFound", { kind: err.kind, id: err.id });
        }
        throw err;
      }
    },
  });
}

function createClockEditSchedule(state: ConsoleState) {
  return flow({
    name: "console.clock.editSchedule",
    unit: "console",
    plane: "operator",
    in: ClockEditIn,
    out: ClockEditOut,
    errors: { AuthFailed, ClockNotFound, ScheduleNotOverridable },
    do: async (input: z.infer<typeof ClockEditIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      try {
        const result = await state.editSchedule({
          name: input.name,
          cron: input.cron,
          every: input.every,
        });
        fx.log.info("console.clock.editSchedule", {
          operatorId: fx.operator.id,
          name: result.name,
        });
        return {
          ok: true as const,
          name: result.name,
          effectiveCron: result.effectiveCron,
          effectiveEvery: result.effectiveEvery,
          at: state.now(),
        };
      } catch (err) {
        if (err instanceof ScheduleNotOverridableError) {
          return fail("ScheduleNotOverridable", { name: err.cronName });
        }
        if (err instanceof ClockResourceNotFoundError) {
          return fail("ClockNotFound", { kind: err.kind, id: err.id });
        }
        throw err;
      }
    },
  });
}

function createClockWakeEarly(state: ConsoleState) {
  return flow({
    name: "console.clock.wakeEarly",
    unit: "console",
    plane: "operator",
    in: ClockWakeEarlyIn,
    out: ClockWakeEarlyOut,
    errors: { AuthFailed, ClockNotFound },
    do: async (input: z.infer<typeof ClockWakeEarlyIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      try {
        const result = await state.wakeEarly(input.runId);
        fx.log.info("console.clock.wakeEarly", {
          operatorId: fx.operator.id,
          runId: result.runId,
          resumed: result.resumed,
        });
        return {
          ok: true as const,
          runId: result.runId,
          wakeAt: result.wakeAt,
          resumed: result.resumed,
          at: state.now(),
        };
      } catch (err) {
        if (err instanceof ClockResourceNotFoundError) {
          return fail("ClockNotFound", { kind: err.kind, id: err.id });
        }
        throw err;
      }
    },
  });
}

function createChannelsList(state: ConsoleState) {
  return flow({
    name: "console.channel.list",
    unit: "console",
    plane: "operator",
    out: ChannelsListOut,
    errors: { AuthFailed },
    do: async (_input, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      return state.listChannels();
    },
  });
}

function createChannelPreview(state: ConsoleState) {
  return flow({
    name: "console.channel.preview",
    unit: "console",
    plane: "operator",
    in: ChannelPreviewIn,
    out: ChannelPreviewOut,
    errors: { AuthFailed, ChannelNotFound },
    do: async (input: z.infer<typeof ChannelPreviewIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      if (
        state.manifest?.channels &&
        !(input.template in state.manifest.channels) &&
        !state.channelRuntime?.templates.has(input.template)
      ) {
        return fail("ChannelNotFound", { template: input.template });
      }
      return state.previewChannel(input);
    },
  });
}

function createChannelVerifyAuth(state: ConsoleState) {
  return flow({
    name: "console.channel.verifyAuth",
    unit: "console",
    plane: "operator",
    in: ChannelVerifyAuthIn,
    out: ChannelVerifyAuthOut,
    errors: { AuthFailed },
    do: async (input: z.infer<typeof ChannelVerifyAuthIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      return state.verifyChannelAuth(input.from);
    },
  });
}

function createChannelReveal(state: ConsoleState) {
  return flow({
    name: "console.channel.reveal",
    unit: "console",
    plane: "operator",
    in: ChannelRevealIn,
    out: ChannelRevealOut,
    errors: { AuthFailed, ChannelNotFound },
    do: async (input: z.infer<typeof ChannelRevealIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const revealed = await state.revealChannel(input.id);
      if (!revealed) {
        return fail("ChannelNotFound", { template: input.id });
      }
      fx.log.info("console.channel.reveal", {
        operatorId: fx.operator.id,
        id: revealed.id,
      });
      return {
        ok: true as const,
        id: revealed.id,
        to: revealed.to,
        at: state.now(),
      };
    },
  });
}

function createChannelSendTest(state: ConsoleState) {
  return flow({
    name: "console.channel.sendTest",
    unit: "console",
    plane: "operator",
    in: ChannelSendTestIn,
    out: ChannelSendTestOut,
    errors: { AuthFailed, ChannelNotFound, ConfirmRequired },
    do: async (input: z.infer<typeof ChannelSendTestIn>, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      if (state.production) {
        if (
          input.confirmation !== "SEND" ||
          (input.reason?.trim().length ?? 0) < 3
        ) {
          return fail("ConfirmRequired", {
            phrase: "SEND" as const,
            reason:
              "send test is a real external send — typed confirmation required",
          });
        }
      }
      if (!state.channelRuntime) {
        return fail("ChannelNotFound", { template: input.template });
      }
      if (
        !state.channelRuntime.templates.has(input.template) &&
        !(state.manifest?.channels && input.template in state.manifest.channels)
      ) {
        return fail("ChannelNotFound", { template: input.template });
      }
      try {
        const result = await state.sendChannelTest({
          template: input.template,
          to: input.to,
          locale: input.locale,
          data: input.data,
        });
        fx.log.info("console.channel.sendTest", {
          operatorId: fx.operator.id,
          template: input.template,
          messageId: result.messageId,
          ok: result.ok,
          reason: input.reason,
        });
        return {
          ...result,
          at: state.now(),
        };
      } catch (err) {
        return fail("ChannelNotFound", {
          template: `${input.template}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
  });
}
