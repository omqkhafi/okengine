/**
 * Debounced domain-schema auto-push for `oke dev` (local mode).
 */

import { basename } from "node:path";

/** Default debounce for schema-change → push. */
export const DB_AUTO_PUSH_DEBOUNCE_MS = 300;

/**
 * Whether a watched path should trigger `oke db push`.
 *
 * Inputs only: declaration / drizzle config / app entry. Never the emit
 * output (`schema.generated.ts`) — push rewrites that file every run, so
 * watching it loops `oke db push` forever under `oke dev`.
 *
 * @param filename - Relative path from the watcher (may be undefined)
 */
export function isDomainSchemaWatchPath(filename: string | null | undefined): boolean {
  if (!filename) return false;
  const normalized = filename.replace(/\\/g, "/");
  const base = basename(normalized);
  // Emit output — never a watch trigger (feedback loop with `oke db push`).
  if (base === "schema.generated.ts" || base === "schema.generated.tsx") return false;
  if (base === "schema.ts" || base === "schema.tsx") return true;
  if (base === "schema.decl.ts" || base === "schema.decl.tsx") return true;
  if (base === "drizzle.config.ts" || base === "drizzle.config.js") return true;
  // App entry / plugins — `.plug()` table contributions feed emit.
  if (base === "app.ts" || base === "app.tsx") return true;
  // Nested domain schemas commonly live under src/**/schema.ts (not .generated).
  if (/(^|\/)schema(\.decl)?\.tsx?$/.test(normalized)) return true;
  return false;
}

/**
 * Resolve whether auto-push is enabled for this `oke dev` session.
 *
 * @param options - Explicit CLI opt-out, config, docker mode
 */
export function resolveDevAutoPush(options: {
  readonly noDbPush?: boolean;
  readonly docker?: boolean;
  readonly configAutoPush?: boolean;
}): boolean {
  if (options.docker) return false;
  if (options.noDbPush) return false;
  return options.configAutoPush !== false;
}

/**
 * Create a debounced callback runner.
 *
 * @param fn - Async work
 * @param ms - Debounce window
 */
export function createDebouncedRunner(
  fn: () => void | Promise<void>,
  ms = DB_AUTO_PUSH_DEBOUNCE_MS,
): {
  readonly trigger: () => void;
  readonly cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    trigger() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void fn();
      }, ms);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
