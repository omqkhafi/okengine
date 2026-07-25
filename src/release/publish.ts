#!/usr/bin/env bun
/**
 * Measure every published budget, print the report, write `budgets.json`
 * and sync `BUDGETS.md`.
 *
 * Exit 1 on any regression. CI runs this as a gate; the snapshot is written
 * locally and committed with releases — not auto-pushed from Actions.
 */

import { resolve } from "node:path";
import {
  budgetsPass,
  formatBudgetsMarkdown,
  formatBudgetsReport,
  measureAllBudgets,
  type BudgetsSnapshot,
} from "./measure.ts";
import { BUDGETS_MD } from "./readme.ts";

const ROOT = resolve(import.meta.dir, "../..");
/** Snapshot path at the repository root. */
export const BUDGETS_JSON = resolve(ROOT, "budgets.json");
/** Generated markdown report (`BUDGETS.md`). */
export const BUDGETS_MARKDOWN = BUDGETS_MD;

/** Options for {@link publishBudgets}. */
export interface PublishBudgetsOptions {
  /** Destination path (defaults to repo-root `budgets.json`). */
  readonly outPath?: string;
  /** Markdown report path (defaults to repo-root `BUDGETS.md`). */
  readonly markdownPath?: string;
  /** Skip writing the snapshot and markdown report. */
  readonly dryRun?: boolean;
  readonly write?: (text: string) => void;
}

/**
 * Measure, print, and optionally persist the budgets snapshot + markdown.
 *
 * @param options - Output / dry-run
 * @returns Exit code (1 when any budget fails)
 */
export async function publishBudgets(
  options: PublishBudgetsOptions = {},
): Promise<{ readonly code: number; readonly snapshot: BudgetsSnapshot }> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const snapshot = await measureAllBudgets();
  write(formatBudgetsReport(snapshot));

  if (!options.dryRun) {
    const path = options.outPath ?? BUDGETS_JSON;
    await Bun.write(path, `${JSON.stringify(snapshot, null, 2)}\n`);
    write(`wrote ${path}\n`);

    const markdownPath = options.markdownPath ?? BUDGETS_MARKDOWN;
    await Bun.write(markdownPath, formatBudgetsMarkdown(snapshot));
    write(`wrote ${markdownPath}\n`);
  }

  return { code: budgetsPass(snapshot) ? 0 : 1, snapshot };
}

if (import.meta.main) {
  const dryRun = process.argv.includes("--dry-run");
  const { code } = await publishBudgets({ dryRun });
  process.exit(code);
}
