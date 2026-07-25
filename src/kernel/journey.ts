/**
 * `journey(name, { path, slo })` — declare a user journey and its SLO.
 *
 * Journeys are Manifest data. The compiler rejects impossible composed
 * availability targets. Runtime registration keeps the declaration alive
 * for Console / doctor.
 */

import type { AnyFlowDef } from "./flow.ts";

/** SLO declared on a journey or flow. */
export interface JourneySlo {
  readonly availability?: string;
  readonly latency?: { readonly p99?: string; readonly p95?: string };
}

/** Options for {@link journey}. */
export interface JourneyOptions {
  /** Ordered flow path that constitutes the journey. */
  readonly path: readonly (AnyFlowDef | string | { readonly name: string })[];
  /** User-facing SLO for the whole path. */
  readonly slo?: JourneySlo;
  /** Optional composed availability string (compiler may fill). */
  readonly composes?: string;
}

/** Registered journey declaration. */
export interface JourneyDecl {
  readonly name: string;
  readonly path: readonly string[];
  readonly slo?: JourneySlo;
  readonly composes?: string;
}

const journeys: JourneyDecl[] = [];

/**
 * Declare a user journey.
 *
 * @param name - Journey id (e.g. `"book-a-flight"`)
 * @param options - Path + SLO
 */
export function journey(name: string, options: JourneyOptions): JourneyDecl {
  const path = options.path.map((p) => {
    if (typeof p === "string") return p;
    if (typeof p === "object" && p !== null && "name" in p) {
      return String(p.name);
    }
    return String(p);
  });
  const decl: JourneyDecl = {
    name,
    path,
    ...(options.slo !== undefined ? { slo: options.slo } : {}),
    ...(options.composes !== undefined ? { composes: options.composes } : {}),
  };
  journeys.push(decl);
  return decl;
}

/**
 * Snapshot of registered journeys.
 */
export function listJourneys(): readonly JourneyDecl[] {
  return journeys.slice();
}

/**
 * Clear journey registry (tests).
 *
 * @internal
 */
export function resetJourneys(): void {
  journeys.length = 0;
}
