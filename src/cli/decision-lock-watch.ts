/**
 * `oke dev` reloads `oke-decisions.lock.json` without restarting.
 * Production reads the file once, at boot.
 */

import { watch } from "node:fs";
import {
  DECISION_LOCK_FILENAME,
  loadDecisionLockfile,
} from "../elements/ai/decisions/certificate.ts";

/** Handle for the lockfile watcher. */
export interface DecisionLockWatch {
  close(): void;
  /** Resolves after the latest reload this watcher started. */
  flushed(): Promise<void>;
}

/**
 * Install `setDecisionLock` whenever the lockfile changes.
 *
 * @param root - App root
 * @param watchFs - Injected watch. The dev server uses `node:fs` on the root.
 */
export function watchDecisionLockfile(
  root: string,
  watchFs?: (
    path: string,
    options: { readonly recursive: true },
    listener: (event: "rename" | "change", filename: string | null) => void,
  ) => { close(): void },
): DecisionLockWatch {
  let pending: Promise<void> = Promise.resolve();
  const reload = (): void => {
    pending = loadDecisionLockfile(root).then(
      () => undefined,
      () => undefined,
    );
  };
  if (watchFs) {
    const handle = watchFs(`${root}/${DECISION_LOCK_FILENAME}`, { recursive: true }, () => {
      reload();
    });
    return { close: () => handle.close(), flushed: () => pending };
  }
  const handle = watch(root, (_event, filename) => {
    if (filename?.toString() !== DECISION_LOCK_FILENAME) return;
    reload();
  });
  return { close: () => handle.close(), flushed: () => pending };
}
