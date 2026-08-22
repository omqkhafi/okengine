/**
 * Request pipeline hooks for element integration.
 *
 * - `onAuth` resolves the principal into `fx.auth` / `fx.operator`
 * - `beforeHandle` evaluates the declared gate chain in registration order,
 *   short-circuiting on the first denial with a typed error value
 *   (`Unauthorized` · `Forbidden` · `RateLimited { retryAfterMs }`)
 *
 * Every evaluation — pass and deny — is recorded on the run's gates dimension.
 * Gate denial is a typed error value, never a thrown exception.
 */

import type { ResolvedTenantAuth } from "../auth/tenant-config.ts";
import type { TenantStore } from "../auth/tenants.ts";
import type { GateEvaluation, GateRuntime } from "../elements/gate.ts";
import type { GatePolicyContext } from "../elements/gate/declare.ts";
import { fail, type FlowFailure } from "./errors.ts";
import type { Fx, FxAuth, FxOperator } from "./fx.ts";
import type { HookFn, InvocationContext } from "./hooks.ts";
import { lazyRequire } from "./lazy-require.ts";
import type { RunTelemetry } from "./run-telemetry.ts";
import type { HttpTrigger, Trigger } from "./triggers.ts";

/** Mutable principal bag shared with {@link createFx}. */
export interface PrincipalBag {
  readonly auth: {
    userId: string | null;
    scopes: Set<string>;
    /** JWT / session scopes — never mutated by tenant-role union. */
    sessionScopes?: Set<string>;
    verified?: boolean;
    apiKeyId?: string | null;
  };
  readonly operator: {
    id: string | null;
  };
  readonly tenant: {
    id: string | null;
  };
}

/** Resolved identity from auth middleware / test harness. */
export interface ResolvedPrincipal {
  readonly plane?: "user" | "operator";
  readonly userId?: string | null;
  readonly operatorId?: string | null;
  readonly scopes?: Iterable<string>;
  readonly verified?: boolean;
  /** Authenticating API key id when Bearer was a key secret. */
  readonly apiKeyId?: string;
  /** Signed `tid` / API-key tenant claim (tier 1). */
  readonly tenantId?: string | null;
}

/** Dependencies for {@link createElementPipelineHooks}. */
export interface PipelineDeps {
  /** Gate runtime (required for gate evaluation). */
  readonly gates?: GateRuntime;
  /**
   * Cryptographically verify a Bearer access token.
   * Required in production when an `Authorization` header is present.
   *
   * @param token - Raw token (no `Bearer ` prefix)
   * @returns Principal on success
   * @throws On forge / expiry / revoke — pipeline maps to `Unauthorized`
   */
  readonly verifyBearer?: (token: string, request?: Request) => Promise<ResolvedPrincipal>;
  /**
   * Optional token extraction (e.g. cookie → Bearer when cookies enabled).
   * When omitted, only `Authorization: Bearer` is read.
   *
   * @param request - Incoming HTTP request
   */
  readonly resolveToken?: (request: Request) => string | undefined;
  /**
   * When true, `ctx.state.principal` / execute `extras.principal` injection
   * is honoured (test harness or console-trusted invoke-as). Must be false
   * for production HTTP request handling.
   */
  readonly allowTestPrincipals?: boolean;
  /**
   * Console Operator invoke — skip the flow's gate chain.
   * Takes effect only when {@link allowTestPrincipals} is also true.
   */
  readonly bypassGates?: boolean;
  /** Per-invocation principal bag (same object passed into createFx). */
  readonly principals: PrincipalBag;
  /** Telemetry collector for the current run (gates dimension). */
  readonly telemetry: RunTelemetry;
  /**
   * When set, resolve `fx.tenant` after the principal and optionally union
   * tenant-role scopes into the live auth bag.
   */
  readonly tenant?: PipelineTenantDeps;
}

/** Tenant identity + conditional scope union (user-plane tenant-scoped flows). */
export interface PipelineTenantDeps {
  readonly config: ResolvedTenantAuth;
  readonly store: TenantStore;
  /** Default true when tenancy is on; `flow({ tenantScoped: false })` opts out. */
  readonly flowTenantScoped: boolean;
  readonly flowPlane?: "user" | "operator";
}

/**
 * Typed gate-denial failures the Gates simulator promises.
 */
export type GateDenialCode = "Unauthorized" | "Forbidden" | "RateLimited";

/**
 * Map a denied gate evaluation to the typed error the simulator promises.
 *
 * @param evaluation - First denying evaluation
 * @param ctx - Policy context at denial time
 */
export function gateDenialFailure(evaluation: GateEvaluation, ctx: GatePolicyContext): FlowFailure {
  if (evaluation.kind === "rate" || evaluation.reason === "rate limited") {
    return fail("RateLimited", {
      retryAfterMs: evaluation.retryAfterMs ?? 0,
    });
  }

  const authenticated = ctx.auth.userId !== null && ctx.auth.userId !== undefined;
  if (!authenticated) {
    return fail("Unauthorized", {});
  }
  return fail("Forbidden", {
    gate: evaluation.name,
    reason: evaluation.reason ?? "policy_denied",
  });
}

/**
 * Collect gate names from an HTTP trigger (registration order).
 *
 * @param trigger - Active trigger
 */
export function gateNamesOf(trigger: Trigger): string[] {
  if (trigger.kind !== "http") return [];
  return (trigger as HttpTrigger).gates.map((g) => (typeof g === "string" ? g : g.name));
}

/**
 * Record evaluations onto run telemetry (pass and deny).
 *
 * @param telemetry - Run collector
 * @param evaluations - Ordered results
 */
export function recordGateEvaluations(
  telemetry: RunTelemetry,
  evaluations: readonly GateEvaluation[],
): void {
  for (const ev of evaluations) {
    telemetry.gates.push(ev.name);
    telemetry.dimensions[`gate:${ev.name}`] = ev.allowed ? "pass" : "deny";
  }
}

/**
 * Apply a resolved principal onto the shared bags (and thus `fx`).
 *
 * @param bag - Mutable principal bag
 * @param resolved - Identity
 */
export function applyPrincipal(bag: PrincipalBag, resolved: ResolvedPrincipal | undefined): void {
  if (!resolved) return;
  if (resolved.plane === "operator" || resolved.operatorId !== undefined) {
    bag.operator.id = resolved.operatorId ?? null;
  }
  if (
    resolved.plane === "user" ||
    resolved.userId !== undefined ||
    resolved.scopes !== undefined ||
    resolved.verified !== undefined
  ) {
    if (resolved.userId !== undefined) bag.auth.userId = resolved.userId;
    if (resolved.scopes !== undefined) {
      bag.auth.scopes.clear();
      for (const s of resolved.scopes) {
        bag.auth.scopes.add(s);
      }
    }
    if (resolved.verified !== undefined) bag.auth.verified = resolved.verified;
    bag.auth.apiKeyId = resolved.apiKeyId ?? null;
  }
  if (resolved.tenantId !== undefined) bag.tenant.id = resolved.tenantId;
}

/**
 * Build `onAuth` + `beforeHandle` hooks for element-aware execution.
 *
 * @param deps - Gate runtime, principal bag, telemetry
 */
export function createElementPipelineHooks(deps: PipelineDeps): {
  readonly onAuth: HookFn;
  readonly beforeHandle: HookFn;
} {
  const onAuth: HookFn = async (ctx) => {
    // Production: never honour injected principals on the request bag.
    if (!deps.allowTestPrincipals && "principal" in ctx.state) {
      delete ctx.state.principal;
    }

    let token: string | undefined;
    if (deps.resolveToken && ctx.request) {
      token = deps.resolveToken(ctx.request);
    } else {
      const header = ctx.request?.headers.get("authorization");
      if (header?.startsWith("Bearer ")) {
        token = header.slice("Bearer ".length).trim() || undefined;
      }
    }

    if (token !== undefined) {
      if (!token) {
        return fail("Unauthorized", {});
      }
      if (!deps.verifyBearer) {
        // Token present but no auth binding — refuse rather than trust.
        return fail("Unauthorized", {});
      }
      try {
        const principal = await deps.verifyBearer(token, ctx.request);
        applyPrincipal(deps.principals, principal);
        if (principal.apiKeyId) {
          deps.telemetry.dimensions.api_key = principal.apiKeyId;
        }
        return applyTenant(deps, ctx);
      } catch {
        // Forge / expiry / revoke → typed Unauthorized (never throw).
        return fail("Unauthorized", {});
      }
    }

    // Test-harness injection only (createTestApp / unit tests).
    if (deps.allowTestPrincipals) {
      const fromState = ctx.state.principal as ResolvedPrincipal | undefined;
      if (fromState) applyPrincipal(deps.principals, fromState);
    }
    return applyTenant(deps, ctx);
  };

  const beforeHandle: HookFn = async (ctx, fxOrErr) => {
    const names = gateNamesOf(ctx.trigger);
    // Empty chain: boot audit should have rejected this when unguardedHttp is
    // "deny". If we still reach here without a gate runtime, skip only for the
    // explicit `autoBoot: false` escape hatch. Public sentinel is a normal
    // named gate in `names`.
    if (names.length === 0 || !deps.gates) return;
    if (deps.bypassGates === true && deps.allowTestPrincipals === true) return;

    const policyCtx = policyContextOf(fxOrErr as Fx, ctx);
    const evaluations = await deps.gates.check(names, policyCtx);
    recordGateEvaluations(deps.telemetry, evaluations);

    const denied = evaluations.find((e) => !e.allowed);
    if (denied) {
      return gateDenialFailure(denied, policyCtx);
    }
  };

  return { onAuth, beforeHandle };
}

function applyTenant(deps: PipelineDeps, ctx: InvocationContext): FlowFailure | undefined {
  if (!deps.tenant) return undefined;
  return lazyRequire<{
    run: (d: PipelineDeps, c: InvocationContext) => FlowFailure | undefined;
  }>(import.meta.dir, ["pipeline", "tenant"].join("-")).run(deps, ctx);
}

/**
 * Build a policy context from the live `fx` principals.
 *
 * @param fx - Fx door
 * @param ctx - Invocation context (for IP / meta)
 */
export function policyContextOf(fx: Fx, ctx: InvocationContext): GatePolicyContext {
  const auth = fx.auth as FxAuth;
  const operator = fx.operator as FxOperator;
  const ip =
    ctx.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    ctx.request?.headers.get("x-real-ip") ??
    undefined;
  return {
    auth: {
      userId: auth.userId,
      scopes: auth.scopes,
      verified: auth.verified,
    },
    operator: { id: operator.id },
    meta: {
      ip,
      userId: auth.userId,
      ...(typeof ctx.state.meta === "object" && ctx.state.meta !== null
        ? (ctx.state.meta as Record<string, unknown>)
        : {}),
    },
  };
}
