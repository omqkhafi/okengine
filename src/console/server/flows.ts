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
import { fail, flow, http, type Binding } from "../../kernel/index.ts";
import type { Flow as ManifestFlow } from "../../manifest/types.ts";
import { bindHttp } from "./bind.ts";
import { verifyClaimCode } from "./claim.ts";
import { createFileDiff, emitStructuralDiff } from "./structural.ts";
import type { ConsoleState } from "./state.ts";

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

const RunsListOut = z.object({
  runs: z.array(
    z.object({
      id: z.string(),
      flow: z.string(),
      plane: z.string(),
      startedAt: z.number(),
      endedAt: z.number(),
      error: z.string().nullable(),
    }),
  ),
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
  phrase: z.literal("INVOKE"),
  reason: z.string(),
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
        runs: all.map((r) => ({
          id: r.id,
          flow: r.flow,
          plane: r.plane,
          startedAt: r.startedAt,
          endedAt: r.endedAt,
          error: r.error?.code ?? null,
        })),
      };
    },
  });
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
