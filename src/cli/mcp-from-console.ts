/**
 * Bind MCP tool adapters to the live Console state (same Manifest / runs).
 *
 * Used by `oke dev` so port 6535 is not a separate mock context.
 */

import {
  createFileDiff,
  emitStructuralDiff,
} from "../console/server/structural.ts";
import type { Manifest } from "../manifest/types.ts";
import type { WideEvent } from "../runs/types.ts";
import type { McpContext } from "../mcp/tools.ts";

/**
 * Minimal Console surface MCP needs — duck-typed so tests can pass a
 * partial stand-in without importing the full {@link ConsoleState}.
 */
export interface McpConsoleSurface {
  /** Live Manifest snapshot (mutated by Console / host). */
  manifest: Manifest | null;
  /** Same runs provider Console panels use. */
  readonly listRuns: () => Promise<readonly WideEvent[]>;
  /** Working-tree root for structural proposals. */
  readonly cwd: string;
  /** Clock shared with Console. */
  readonly now: () => number;
}

/**
 * Create an {@link McpContext} that reads through a live Console surface.
 *
 * @param state - Console state (or test stand-in)
 */
export function mcpContextFromConsole(state: McpConsoleSurface): McpContext {
  return {
    getManifest: () => state.manifest,
    listRuns: () => state.listRuns(),
    proposeStructural: async (input) =>
      emitStructuralDiff({
        cwd: state.cwd,
        title: input.title,
        relativePath: input.relativePath,
        diff: createFileDiff(input.relativePath, input.contents),
        actorId: input.operatorId,
        reason: input.reason,
        now: state.now,
      }),
  };
}
