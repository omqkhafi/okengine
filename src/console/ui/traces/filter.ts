/**
 * Filter traces by declared effect (console §9.3).
 *
 * Because effects are declared, this is a query rather than a text search.
 */

import type { EffectFilter, TraceSpan } from "./types.ts";

/**
 * Whether a span matches an effect filter.
 *
 * @param span - Span to test
 * @param filter - Effect filter, or null for match-all
 */
export function matchesEffectFilter(
  span: TraceSpan,
  filter: EffectFilter | null | undefined,
): boolean {
  if (!filter) return true;
  switch (filter.kind) {
    case "wrote":
      return span.effects.some((e) => e.kind === "write" && e.resource === filter.resource);
    case "asked":
      return span.effects.some((e) => e.kind === "ask");
    case "sent":
      return span.effects.some(
        (e) =>
          e.kind === "send" && (filter.resource === undefined || e.resource === filter.resource),
      );
    case "secret":
      return span.effects.some(
        (e) =>
          e.kind === "secret" && (filter.resource === undefined || e.resource === filter.resource),
      );
    case "cost":
      return (span.cost ?? 0) > filter.min;
  }
}

/**
 * Whether any span in a root's connected component matches.
 *
 * @param spans - Spans in the trace
 * @param filter - Effect filter
 */
export function traceMatchesEffectFilter(
  spans: readonly TraceSpan[],
  filter: EffectFilter | null | undefined,
): boolean {
  if (!filter) return true;
  return spans.some((s) => matchesEffectFilter(s, filter));
}

/**
 * Parse a compact effect-filter string from the URL.
 *
 * Forms: `wrote:sql:bookings`, `asked`, `sent`, `sent:booking-confirmed`,
 * `secret:STRIPE_KEY`, `cost:0.05`.
 *
 * @param raw - URL value
 */
export function parseEffectFilter(raw: string | undefined): EffectFilter | null {
  if (!raw?.trim()) return null;
  const value = raw.trim();
  if (value === "asked") return { kind: "asked" };
  if (value === "sent") return { kind: "sent" };
  if (value.startsWith("wrote:")) {
    return { kind: "wrote", resource: value.slice("wrote:".length) };
  }
  if (value.startsWith("sent:")) {
    return { kind: "sent", resource: value.slice("sent:".length) };
  }
  if (value.startsWith("secret:")) {
    return { kind: "secret", resource: value.slice("secret:".length) };
  }
  if (value === "secret") return { kind: "secret" };
  if (value.startsWith("cost:")) {
    const min = Number(value.slice("cost:".length));
    if (!Number.isFinite(min)) return null;
    return { kind: "cost", min };
  }
  return null;
}

/**
 * Serialise an effect filter for the URL.
 *
 * @param filter - Filter
 */
export function serializeEffectFilter(filter: EffectFilter | null | undefined): string | undefined {
  if (!filter) return undefined;
  switch (filter.kind) {
    case "wrote":
      return `wrote:${filter.resource}`;
    case "asked":
      return "asked";
    case "sent":
      return filter.resource ? `sent:${filter.resource}` : "sent";
    case "secret":
      return filter.resource ? `secret:${filter.resource}` : "secret";
    case "cost":
      return `cost:${filter.min}`;
  }
}
