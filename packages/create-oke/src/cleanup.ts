/**
 * Abort-safe cleanup for a create-oke destination that this process created.
 *
 * Windows often fails mid-`rmSync` (`EBUSY` — Explorer, antivirus, or a child
 * cwd still holding the tree). Throwing from SIGINT then leaves a half-deleted
 * project. Callers must not wipe after files are committed.
 */

import { existsSync, rmSync } from "node:fs";

/**
 * Whether abort / scaffold failure may delete `targetDir`.
 *
 * Never wipe a folder that already existed, or one whose files were committed
 * (scaffold returned). Ctrl+C during install or `bun run dev` must leave the
 * project in place.
 *
 * @param existed - `existsSync(targetDir)` before this process created it
 * @param filesCommitted - `true` after a successful scaffold return
 */
export function shouldWipeNewProject(existed: boolean, filesCommitted: boolean): boolean {
  return !existed && !filesCommitted;
}

/**
 * Best-effort recursive delete. Swallows errors so abort paths never throw.
 *
 * @param targetDir - Absolute or cwd-relative destination
 */
export function wipeNewProjectDir(targetDir: string): void {
  if (!existsSync(targetDir)) return;
  try {
    rmSync(targetDir, { recursive: true, force: true });
  } catch {
    // Locked handles (Windows Explorer, bun cwd, antivirus) fail mid-tree.
  }
}
