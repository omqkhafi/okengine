/**
 * Flatten `gate.all` handles and the reserved public name.
 *
 * Kept off {@link ./declare.ts} so HTTP triggers can attach gates without
 * pulling `gate.rate` into a Store-only graph.
 */

import type { GateDecl } from "./declare.ts";

/** Reserved policy name for `gate.public` / `.gate.public`. */
export const GATE_PUBLIC_NAME = "public";

/** Member of `gate.all` — a policy/rate or a nested `all` handle. */
export type GateMember = GateDecl | GateAllDecl;

/**
 * Reusable gate chain from `gate.all`. Flattens at `.gate(handle)` —
 * not a new evaluation primitive.
 */
export interface GateAllDecl {
  readonly kind: "all";
  readonly members: readonly GateMember[];
}

/**
 * True when `value` is a {@link GateAllDecl}.
 *
 * @param value - Unknown handle
 */
export function isGateAllDecl(value: unknown): value is GateAllDecl {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "all" &&
    Array.isArray((value as { members?: unknown }).members)
  );
}

/**
 * Flatten nested `gate.all` handles to policy / rate decls.
 *
 * @param members - Mixed members
 */
export function flattenGateMembers(members: readonly GateMember[]): GateDecl[] {
  const out: GateDecl[] = [];
  for (const member of members) {
    if (isGateAllDecl(member)) out.push(...flattenGateMembers(member.members));
    else out.push(member);
  }
  return out;
}

/**
 * Flatten `.gate(...)` args — decls, `all` handles, and arrays — to named refs.
 *
 * @param args - Mixed attach args
 */
export function flattenGateArgs(
  args: readonly unknown[],
): Array<string | { readonly name: string }> {
  const out: Array<string | { readonly name: string }> = [];
  for (const arg of args) {
    if (isGateAllDecl(arg)) {
      out.push(...flattenGateMembers(arg.members));
      continue;
    }
    if (Array.isArray(arg)) {
      out.push(...flattenGateArgs(arg));
      continue;
    }
    out.push(arg as string | { readonly name: string });
  }
  return out;
}
