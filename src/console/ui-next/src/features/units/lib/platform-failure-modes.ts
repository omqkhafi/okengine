/**
 * Derive request-facing platform failure modes from a flow's own Manifest
 * gates + input schema — HTTP-encoding truth from {@link statusForFailure}.
 *
 * Never invents OKE#### codes or a static global list.
 */

import type { Flow, Manifest } from "../../../../../../manifest/types.ts";
import { VALIDATION_ERROR_CODE } from "../../../../../../validation/standard-schema.ts";

/** Platform codes a real HTTP caller can receive for this flow's contract. */
export type PlatformFailureCode =
  | "Unauthorized"
  | "Forbidden"
  | "RateLimited"
  | typeof VALIDATION_ERROR_CODE;

/** One derived platform failure mode for the Units contract panel. */
export type PlatformFailureMode = {
  readonly code: PlatformFailureCode;
  /** HTTP status a real caller sees (`statusForFailure` / encodeFailure). */
  readonly status: 401 | 403 | 422 | 429;
  /** Where this mode was derived from. */
  readonly source: "gate" | "schema";
  /** Gate name when `source === "gate"`. */
  readonly gateName?: string;
  /** Short human detail (gate kind / throttle / schema). */
  readonly detail: string;
};

/**
 * Whether the flow declares an input schema that can reject with ValidationError.
 *
 * @param input - Manifest `flow.in` (object schema, `$ref` string, or absent)
 */
export function flowDeclaresInputSchema(input: Flow["in"]): boolean {
  if (input === undefined || input === null) return false;
  if (typeof input === "string") return input.length > 0;
  if (typeof input === "object") return true;
  return false;
}

/**
 * Derive platform failure modes from this flow's gates + input schema only.
 *
 * HTTP status values match {@link statusForFailure} (ValidationError → 422),
 * not Call API chrome's `statusForInvokeFailure` default (400).
 *
 * @param flow - Manifest flow row
 * @param manifest - Live Manifest (for gate definitions)
 */
export function platformFailureModes(
  flow: Pick<Flow, "gates" | "in">,
  manifest: Manifest | null | undefined,
): readonly PlatformFailureMode[] {
  const out: PlatformFailureMode[] = [];
  const gateDefs = manifest?.gates ?? {};

  for (const name of flow.gates ?? []) {
    if (name === "public") continue;
    const def = gateDefs[name];
    const kind = def?.kind ?? null;

    if (kind === "rate") {
      const parts = [
        "rate",
        def?.strategy,
        def?.max !== undefined && def.per !== undefined ? `${def.max}/${def.per}` : undefined,
        def?.keyBy !== undefined ? `keyBy ${def.keyBy}` : undefined,
        def?.description ?? undefined,
      ].filter((p): p is string => typeof p === "string" && p.length > 0);
      out.push({
        code: "RateLimited",
        status: 429,
        source: "gate",
        gateName: name,
        detail: parts.join(" · "),
      });
      continue;
    }

    // Policy (declared or undeclared-but-named): auth / authorization denials.
    // `public` already skipped. Unknown kind still treated as policy-shaped —
    // Gates simulator maps missing principal → Unauthorized, failed check → Forbidden.
    const policyParts = [
      kind === "policy" ? "policy" : kind === null ? "undeclared gate" : kind,
      def?.scopes !== undefined && def.scopes.length > 0
        ? `scopes ${def.scopes.join(", ")}`
        : undefined,
      def?.roles !== undefined && def.roles.length > 0
        ? `roles ${def.roles.join(", ")}`
        : undefined,
      def?.description ?? undefined,
    ].filter((p): p is string => typeof p === "string" && p.length > 0);

    const detail = policyParts.join(" · ");
    out.push({
      code: "Unauthorized",
      status: 401,
      source: "gate",
      gateName: name,
      detail: `${detail} · unauthenticated`,
    });
    out.push({
      code: "Forbidden",
      status: 403,
      source: "gate",
      gateName: name,
      detail: `${detail} · authenticated but denied`,
    });
  }

  if (flowDeclaresInputSchema(flow.in)) {
    out.push({
      code: VALIDATION_ERROR_CODE,
      status: 422,
      source: "schema",
      detail: "Malformed or invalid request body / input",
    });
  }

  return out;
}
