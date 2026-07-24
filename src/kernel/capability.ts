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
const UNDECLARED_KEY: Readonly<
  Record<EffectKind, keyof typeof OKE_ERRORS>
> = {
  read: "UNDECLARED_READ",
  write: "UNDECLARED_WRITE",
  emit: "UNDECLARED_EMIT",
  send: "UNDECLARED_SEND",
  ask: "UNDECLARED_ASK",
  secret: "UNDECLARED_SECRET",
  call: "UNDECLARED_CALL",
};

/** Maps effect kind → the corresponding `Effects` field. */
const EFFECTS_FIELD: Readonly<
  Record<EffectKind, keyof Effects>
> = {
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
 * @param flow - Flow id (used in error messages)
 * @param declared - Declared effect surface (missing keys = empty allow-list)
 */
export function createCapabilityToken(
  flow: string,
  declared: Effects = {},
): CapabilityToken {
  const sets: Record<EffectKind, ReadonlySet<string>> = {
    read: new Set(declared.reads ?? []),
    write: new Set(declared.writes ?? []),
    emit: new Set(declared.emits ?? []),
    send: new Set(declared.sends ?? []),
    ask: new Set(declared.asks ?? []),
    secret: new Set(declared.secrets ?? []),
    call: new Set(declared.calls ?? []),
  };

  return {
    flow,
    declared,
    allows(kind: EffectKind, resource: string): boolean {
      return sets[kind].has(resource);
    },
    assert(kind: EffectKind, resource: string): void {
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
