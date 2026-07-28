/**
 * Bridge to the real oxc Manifest extractor (never a parallel parser).
 */

import {
  extractManifest,
  type SourceFile,
} from "../../../src/compiler/extract.ts";
import type { Effects, Flow, Manifest } from "../../../src/manifest/types.ts";
import { formatEffectsCodeLens } from "./format-effects.ts";

/** One CodeLens candidate for a flow in a document. */
export interface FlowEffectsLens {
  /** Flow id (`unit.name` / `name`). */
  readonly flowId: string;
  /** 0-based line for the CodeLens (VS Code). */
  readonly line: number;
  /** Formatted effects title. */
  readonly title: string;
  /** Raw effects object. */
  readonly effects: Effects;
}

/** Debounce for save/change coalescing (see package README). */
export const EXTRACT_DEBOUNCE_MS = 300;

/**
 * Extract lenses for flows whose `source` points at `relativePath`.
 *
 * @param relativePath - Path relative to workspace root (as in Manifest)
 * @param files - Project sources (open file + siblings for bindings)
 */
export async function lensesForFile(
  relativePath: string,
  files: readonly SourceFile[],
): Promise<FlowEffectsLens[]> {
  const manifest = await extractManifest({ files });
  return lensesFromManifest(manifest, relativePath);
}

/**
 * Project Manifest flows onto CodeLens rows for one file.
 *
 * @param manifest - Extracted Manifest
 * @param relativePath - File path using `/` separators
 */
export function lensesFromManifest(
  manifest: Manifest,
  relativePath: string,
): FlowEffectsLens[] {
  const normalized = relativePath.replace(/\\/g, "/");
  const out: FlowEffectsLens[] = [];
  for (const [flowId, flow] of Object.entries(manifest.flows ?? {})) {
    const lens = lensForFlow(flowId, flow, normalized);
    if (lens) out.push(lens);
  }
  out.sort((a, b) => a.line - b.line);
  return out;
}

/**
 * @param flowId - Flow id
 * @param flow - Manifest flow
 * @param relativePath - Target file
 */
function lensForFlow(
  flowId: string,
  flow: Flow,
  relativePath: string,
): FlowEffectsLens | undefined {
  if (!flow.source) return undefined;
  const colon = flow.source.lastIndexOf(":");
  if (colon === -1) return undefined;
  const path = flow.source.slice(0, colon).replace(/\\/g, "/");
  const line1 = Number(flow.source.slice(colon + 1));
  if (path !== relativePath || !Number.isFinite(line1) || line1 < 1) {
    return undefined;
  }
  const title = formatEffectsCodeLens(flow.effects);
  if (!title || !flow.effects) return undefined;
  return {
    flowId,
    line: line1 - 1,
    title,
    effects: flow.effects,
  };
}
