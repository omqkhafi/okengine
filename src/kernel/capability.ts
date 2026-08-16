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
  /**
   * `true` when the compiler has not stamped effects (`declared` was
   * `undefined` at mint). Open tokens allow every access; empty
   * `declared` is then "unknown", not least-privilege deny.
   */
  readonly open: boolean;
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
    open,
    declared: effects,
    allows(kind: EffectKind, resource: string): boolean {
      if (open) return true;
      return allowsResource(kind, sets[kind], resource);
    },
    assert(kind: EffectKind, resource: string): void {
      if (open) return;
      if (allowsResource(kind, sets[kind], resource)) return;
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

/**
 * Exact match for every kind. `ask` also treats PromptRef pins as
 * interchangeable: declared `name@version` allows asking `name`, and
 * declared `name` allows asking `name@version`. Distinct pins do not match.
 */
function allowsResource(
  kind: EffectKind,
  declared: ReadonlySet<string>,
  resource: string,
): boolean {
  if (declared.has(resource)) return true;
  return kind === "ask" && promptPinAllows(declared, resource);
}

/** Prompt refs are `name` or `name@version` — either side may omit the pin. */
function promptPinAllows(declared: ReadonlySet<string>, resource: string): boolean {
  const asked = parsePromptPin(resource);
  for (const entry of declared) {
    const pin = parsePromptPin(entry);
    if (pin.name !== asked.name) continue;
    if (pin.version === undefined || asked.version === undefined || pin.version === asked.version) {
      return true;
    }
  }
  return false;
}

function parsePromptPin(ref: string): { readonly name: string; readonly version?: number } {
  const at = ref.lastIndexOf("@");
  if (at <= 0) return { name: ref };
  const tail = ref.slice(at + 1);
  if (!/^\d+$/.test(tail)) return { name: ref };
  return { name: ref.slice(0, at), version: Number(tail) };
}
