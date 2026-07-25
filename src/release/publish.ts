#!/usr/bin/env bun
/**
 * Measure every published budget, print the report, write `budgets.json`.
 *
 * Exit 1 on any regression. On `main` CI the updated snapshot is committed
 * so numbers are comparable across git history.
 */

import { resolve } from "node:path";
import {
  budgetsPass,
  formatBudgetsReport,
  measureAllBudgets,
  type BudgetsSnapshot,
} from "./measure.ts";

const ROOT = resolve(import.meta.dir, "../..");
/** Snapshot path at the repository root. */
export const BUDGETS_JSON = resolve(ROOT, "budgets.json");

/** Options for {@link publishBudgets}. */
export interface PublishBudgetsOptions {
  /** Destination path (defaults to repo-root `budgets.json`). */
  readonly outPath?: string;
  /** Skip writing the snapshot file. */
  readonly dryRun?: boolean;
  readonly write?: (text: string) => void;
}

/**
 * Measure, print, and optionally persist the budgets snapshot.
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
  }

  return { code: budgetsPass(snapshot) ? 0 : 1, snapshot };
}

if (import.meta.main) {
  const dryRun = process.argv.includes("--dry-run");
  const { code } = await publishBudgets({ dryRun });
  process.exit(code);
}
