/**
 * Gate boot audit — every HTTP trigger must declare auth posture.
 *
 * Fail loud: missing gate and missing {@link gate.public} → {@link GateBootError}.
 * `unguardedHttp: "allow"` is honoured **only** when `env === "test"` — never a
 * production-wide bypass. Migrate real apps with per-trigger `gate.public`.
 */

import { GATE_PUBLIC_NAME } from "./declare.ts";

/** One HTTP flow missing declared auth posture. */
export interface GatePostureGap {
  /** Flow id (`unit.name` or flow name). */
  readonly flowId: string;
  /** HTTP method. */
  readonly method: string;
  /** HTTP path template. */
  readonly path: string;
}

/**
 * Thrown when HTTP triggers omit both a gate chain and {@link gate.public}.
 * Lists every gap (Vault-style — fail once with the full set).
 */
export class GateBootError extends Error {
  readonly gaps: readonly GatePostureGap[];

  constructor(gaps: readonly GatePostureGap[]) {
    const lines = gaps.map((g) => `  - ${g.flowId} ${g.method} ${g.path}`);
    super(
      `gate boot failed — ${gaps.length} HTTP trigger(s) missing auth posture (attach a gate or gate.public):\n${lines.join("\n")}`,
    );
    this.name = "GateBootError";
    this.gaps = gaps;
  }
}

/** Minimal HTTP trigger shape for posture audit. */
export interface HttpTriggerPosture {
  readonly kind: "http";
  readonly method: string;
  readonly path: string;
  readonly gates: readonly (string | { readonly name: string })[];
}

/** Binding shape consumed by the audit. */
export interface BindingPosture {
  readonly trigger: { readonly kind: string } & Omit<Partial<HttpTriggerPosture>, "kind">;
  readonly flow: { readonly name: string };
}

/** Options for {@link assertHttpGatePosture}. */
export interface AssertHttpGatePostureOptions {
  /**
   * `"allow"` skips the audit **only** when {@link env} is `"test"`.
   * Outside test, `"allow"` has no effect — enforcement still runs.
   */
  readonly unguardedHttp?: "deny" | "allow";
  /**
   * Boot environment. Hard-coded gate: `"allow"` is ignored unless this is
   * `"test"` (not developer-overridable beyond the env value itself).
   */
  readonly env?: string;
}

/**
 * Whether a gate ref is the public sentinel.
 *
 * @param ref - Gate name or named handle
 */
export function isPublicGateRef(ref: string | { readonly name: string }): boolean {
  return (typeof ref === "string" ? ref : ref.name) === GATE_PUBLIC_NAME;
}

/**
 * Whether an HTTP trigger has declared auth posture (any gate or public).
 *
 * @param gates - Trigger gate chain
 */
export function hasHttpGatePosture(
  gates: readonly (string | { readonly name: string })[],
): boolean {
  return gates.length > 0;
}

/**
 * Collect HTTP triggers with neither a gate nor {@link gate.public}.
 *
 * @param bindings - Adopted / registered bindings
 */
export function collectUnguardedHttpGaps(bindings: readonly BindingPosture[]): GatePostureGap[] {
  const gaps: GatePostureGap[] = [];
  for (const b of bindings) {
    if (b.trigger.kind !== "http") continue;
    const t = b.trigger as HttpTriggerPosture;
    if (hasHttpGatePosture(t.gates)) continue;
    gaps.push({
      flowId: b.flow.name,
      method: t.method,
      path: t.path,
    });
  }
  return gaps;
}

/**
 * Whether `unguardedHttp: "allow"` may skip the audit for this boot.
 * Hard-coded: only `env === "test"`.
 *
 * @param unguardedHttp - Requested opt-out
 * @param env - Boot environment
 */
export function unguardedHttpAllowActive(
  unguardedHttp: "deny" | "allow" | undefined,
  env: string | undefined,
): boolean {
  return unguardedHttp === "allow" && env === "test";
}

/**
 * Assert every HTTP trigger declares auth posture. Throws {@link GateBootError}.
 *
 * @param bindings - Adopted / registered bindings
 * @param options - Opt-out + env (allow only in test)
 */
export function assertHttpGatePosture(
  bindings: readonly BindingPosture[],
  options: AssertHttpGatePostureOptions | "deny" | "allow" = "deny",
): void {
  // Back-compat: second arg was previously just `"deny" | "allow"`.
  const opts: AssertHttpGatePostureOptions =
    typeof options === "string" ? { unguardedHttp: options } : options;
  if (unguardedHttpAllowActive(opts.unguardedHttp, opts.env)) return;
  const gaps = collectUnguardedHttpGaps(bindings);
  if (gaps.length > 0) throw new GateBootError(gaps);
}
