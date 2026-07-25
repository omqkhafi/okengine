/**
 * Path helpers for the generated budgets markdown document.
 *
 * The tables live in `BUDGETS.md` at the repo root (rewritten by
 * `bun run budgets`). README only links there.
 */

import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");

/** Generated budgets report (markdown tables). */
export const BUDGETS_MD = resolve(ROOT, "BUDGETS.md");
