/**
 * Gate runtime — evaluate policy / rate chain in registration order.
 */

import { parseDurationMs } from "../clock/duration.ts";
import {
  flattenGateMembers,
  gate,
  isGateAllDecl,
  type GateAllDecl,
  type GateDecl,
  type GatePolicyContext,
  type RateGateDecl,
} from "./declare.ts";
import { takeRate } from "./strategies.ts";

/** KV surface required for rate gates. */
export interface GateKv {
  /** Driver id when known (`memory` · `redis`; SQL ids unused on rate gates). */
  readonly driverId?: "memory" | "redis" | "postgres" | "pglite";
  eval<T = unknown>(script: string, keys: readonly string[], args?: readonly string[]): Promise<T>;
}

/** Options for {@link createGateRuntime}. */
export interface CreateGateRuntimeOptions {
  /** Registered gate declarations. */
  readonly gates?: readonly (GateDecl | GateAllDecl)[];
  /** KV namespace for rate strategies (required when any rate gate exists). */
  readonly kv?: GateKv;
  /** Injectable clock. */
  readonly now?: () => number;
}

/** Result of evaluating one gate. */
export interface GateEvaluation {
  readonly name: string;
  readonly allowed: boolean;
  readonly kind: "policy" | "rate";
  readonly remaining?: number;
  readonly retryAfterMs?: number;
  readonly reason?: string;
}

/** Gate runtime surface. */
export interface GateRuntime {
  /** Registered declarations by name. */
  readonly gates: ReadonlyMap<string, GateDecl>;
  /** KV backend used for rate limits (`memory` · `redis`, or unset). */
  readonly kvDriverId: "memory" | "redis" | "postgres" | "pglite" | undefined;
  /**
   * Evaluate a gate chain in order; stop on first denial.
   *
   * @param names - Gate names / rate ids
   * @param ctx - Policy context
   */
  check(names: readonly string[], ctx: GatePolicyContext): Promise<GateEvaluation[]>;
  /**
   * Whether every gate in the chain allows.
   *
   * @param names - Gate names
   * @param ctx - Policy context
   */
  allow(names: readonly string[], ctx: GatePolicyContext): Promise<boolean>;
}

/**
 * Create a Gate runtime.
 *
 * @param options - Declarations + kv
 */
export function createGateRuntime(options: CreateGateRuntimeOptions = {}): GateRuntime {
  const map = new Map<string, GateDecl>();
  // Built-in sentinel — `.gate.public` works without listing it in `oke({ gates })`.
  map.set(gate.public.name, gate.public);
  for (const g of options.gates ?? []) {
    if (isGateAllDecl(g)) {
      for (const member of flattenGateMembers(g.members)) map.set(member.name, member);
    } else {
      map.set(g.name, g);
    }
  }
  const now = options.now ?? (() => Date.now());
  const kvDriverId = options.kv?.driverId;

  async function evaluateOne(name: string, ctx: GatePolicyContext): Promise<GateEvaluation> {
    const decl = map.get(name);
    if (!decl) {
      return {
        name,
        kind: "policy",
        allowed: false,
        reason: `unknown gate: ${name}`,
      };
    }
    if (decl.kind === "policy") {
      const allowed = await decl.check(ctx);
      return {
        name,
        kind: "policy",
        allowed,
        reason: allowed ? undefined : "policy denied",
      };
    }
    return evaluateRate(decl, ctx);
  }

  async function evaluateRate(decl: RateGateDecl, ctx: GatePolicyContext): Promise<GateEvaluation> {
    if (!options.kv) {
      return {
        name: decl.name,
        kind: "rate",
        allowed: false,
        reason: "rate gate requires kv",
      };
    }
    const windowMs = parseDurationMs(decl.per);
    if (windowMs <= 0) {
      return {
        name: decl.name,
        kind: "rate",
        allowed: false,
        reason: `invalid per: ${decl.per}`,
      };
    }
    const subject = resolveSubject(decl.keyBy, ctx);
    const result = await takeRate(options.kv, {
      strategy: decl.strategy,
      max: decl.max,
      windowMs,
      subject: `${decl.name}:${subject}`,
      nowMs: now(),
    });
    return {
      name: decl.name,
      kind: "rate",
      allowed: result.allowed,
      remaining: result.remaining,
      retryAfterMs: result.retryAfterMs,
      reason: result.allowed ? undefined : "rate limited",
    };
  }

  return {
    gates: map,
    kvDriverId,
    async check(names, ctx) {
      const out: GateEvaluation[] = [];
      for (const name of names) {
        const ev = await evaluateOne(name, ctx);
        out.push(ev);
        if (!ev.allowed) break;
      }
      return out;
    },
    async allow(names, ctx) {
      const evs = await this.check(names, ctx);
      return evs.length === 0 || evs.every((e) => e.allowed);
    },
  };
}

function resolveSubject(keyBy: string | undefined, ctx: GatePolicyContext): string {
  switch (keyBy) {
    case "user":
      return ctx.auth.userId ?? ctx.meta?.userId ?? "anon";
    case "ip":
      return String(ctx.meta?.ip ?? "0.0.0.0");
    case "operator":
      return ctx.operator.id ?? "anon";
    case undefined:
    case "global":
      return "global";
    default:
      return String(ctx.meta?.[keyBy] ?? keyBy);
  }
}
