/**
 * Per-flow capability tokens — least privilege by construction (§7.4).
 *
 * A flow receives a token covering only its declared effects. An undeclared
 * access throws OKE1xxx with the flow name, the attempted resource, and the fix.
 * Enforced at runtime, not merely documented.
 */

import type { Effects } from "../manifest/types.ts";
import type { EffectKind } from "./effects.ts";
import { OKE_ERRORS, throwOke } from "./errors.ts";

/** Maps effect kind → the undeclared-access registry key. */
const UNDECLARED_KEY: Readonly<Record<EffectKind, keyof typeof OKE_ERRORS>> = {
  read: "UNDECLARED_READ",
  write: "UNDECLARED_WRITE",
  emit: "UNDECLARED_EMIT",
  send: "UNDECLARED_SEND",
  ask: "UNDECLARED_ASK",
  secret: "UNDECLARED_SECRET",
  call: "UNDECLARED_CALL",
};

/** Maps effect kind → the corresponding `Effects` field. */
const EFFECTS_FIELD: Readonly<Record<EffectKind, keyof Effects>> = {
  read: "reads",
  write: "writes",
  emit: "emits",
  send: "sends",
  ask: "asks",
  secret: "secrets",
  call: "calls",
};

/**
 * Capability token for one flow invocation.
 * Allows only the resources listed in the flow's declared effects.
 */
export interface CapabilityToken {
  /** Flow id this token was issued for. */
  readonly flow: string;
  /** Declared effects that minted this token. */
  readonly declared: Effects;
  /**
   * Assert that `kind` on `resource` is allowed.
   * Throws {@link OkeError} (OKE1xxx) on violation.
   *
   * @param kind - Effect kind being attempted
   * @param resource - Resource / signal / template / … ref
   */
  assert(kind: EffectKind, resource: string): void;
  /**
   * Whether `kind` on `resource` is allowed (no throw).
   *
   * @param kind - Effect kind
   * @param resource - Resource ref
   */
  allows(kind: EffectKind, resource: string): boolean;
}

/**
 * Mint a capability token from a flow's declared effects.
 *
 * When `declared` is `undefined` (compiler has not yet stamped effects),
 * the token is open — every access is allowed and ledgered. An explicit
 * `{}` or partial declaration is least-privilege (missing keys = deny).
 *
 * @param flow - Flow id (used in error messages)
 * @param declared - Declared effect surface, or `undefined` for open
 */
export function createCapabilityToken(flow: string, declared?: Effects): CapabilityToken {
  const open = declared === undefined;
  const effects = declared ?? {};
  const sets: Record<EffectKind, ReadonlySet<string>> = {
    read: new Set(effects.reads ?? []),
    write: new Set(effects.writes ?? []),
    emit: new Set(effects.emits ?? []),
    send: new Set(effects.sends ?? []),
    ask: new Set(effects.asks ?? []),
    secret: new Set(effects.secrets ?? []),
    call: new Set(effects.calls ?? []),
  };

  return {
    flow,
    declared: effects,
    allows(kind: EffectKind, resource: string): boolean {
      if (open) return true;
      return sets[kind].has(resource);
    },
    assert(kind: EffectKind, resource: string): void {
      if (open) return;
      if (sets[kind].has(resource)) return;
      throwOke(UNDECLARED_KEY[kind], { flow, resource });
    },
  };
}

/**
 * Effects-field name for a kind (e.g. `read` → `"reads"`).
 *
 * @param kind - Effect kind
 */
export function effectsFieldOf(kind: EffectKind): keyof Effects {
  return EFFECTS_FIELD[kind];
}
