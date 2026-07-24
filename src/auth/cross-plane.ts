/**
 * Cross-plane compile checks — application principals never reach console flows.
 *
 * @see docs/spec/console.md §2.2
 */

import type { Manifest } from "../manifest/types.ts";
import { CrossPlaneError } from "./planes.ts";

/** One cross-plane diagnostic. */
export interface CrossPlaneDiagnostic {
  readonly flow: string;
  readonly message: string;
}

/** Source snippet used for principal-usage analysis. */
export interface PlaneSourceFile {
  readonly path: string;
  readonly source: string;
  /** Flow id this file contributes to (when known). */
  readonly flow?: string;
}

/**
 * Compile-time check: application principal (`fx.auth`) must not reach
 * operator-plane (console) flows; user-plane flows must not call operator flows.
 *
 * @param manifest - Extracted Manifest
 * @param sources - Optional source files for `fx.auth` / `fx.operator` usage
 * @returns Diagnostics (empty when clean)
 */
export function checkCrossPlane(
  manifest: Manifest,
  sources: readonly PlaneSourceFile[] = [],
): CrossPlaneDiagnostic[] {
  const diagnostics: CrossPlaneDiagnostic[] = [];
  const planes = new Map<string, "user" | "operator">();

  for (const [id, flow] of Object.entries(manifest.flows ?? {})) {
    planes.set(id, flow.plane ?? "user");
  }

  for (const [id, flow] of Object.entries(manifest.flows ?? {})) {
    const plane = flow.plane ?? "user";
    for (const callee of flow.effects?.calls ?? []) {
      const calleePlane = planes.get(callee);
      if (calleePlane === "operator" && plane === "user") {
        diagnostics.push({
          flow: id,
          message: `cross-plane call: user flow "${id}" calls operator flow "${callee}"`,
        });
      }
    }
  }

  for (const file of sources) {
    const flowId = file.flow ?? inferFlowFromPath(file.path);
    if (!flowId) continue;
    const plane = planes.get(flowId) ?? inferPlaneFromSource(file.source);
    if (plane === "operator" && /\bfx\.auth\b/.test(file.source)) {
      diagnostics.push({
        flow: flowId,
        message: `application principal (fx.auth) reaches console flow "${flowId}"`,
      });
    }
  }

  return diagnostics;
}

/**
 * Assert cross-plane isolation; throw {@link CrossPlaneError} on violation.
 *
 * @param manifest - Manifest
 * @param sources - Sources
 */
export function assertCrossPlane(
  manifest: Manifest,
  sources: readonly PlaneSourceFile[] = [],
): void {
  const diagnostics = checkCrossPlane(manifest, sources);
  if (diagnostics.length > 0) {
    throw new CrossPlaneError(diagnostics.map((d) => d.message).join("; "));
  }
}

function inferFlowFromPath(path: string): string | undefined {
  // …/flows/bookings/create.ts → bookings.create
  const m = /flows\/([^/]+)\/([^/]+)\.(ts|tsx|js)$/.exec(path.replace(/\\/g, "/"));
  if (m) return `${m[1]}.${m[2]}`;
  return undefined;
}

function inferPlaneFromSource(source: string): "user" | "operator" | undefined {
  if (/plane\s*:\s*["']operator["']/.test(source)) return "operator";
  if (/plane\s*:\s*["']user["']/.test(source)) return "user";
  return undefined;
}
