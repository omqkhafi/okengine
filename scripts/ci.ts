#!/usr/bin/env bun
/**
 * Run OKE's CI checks with readable local and GitHub Actions output.
 *
 * Usage:
 *   bun run ci
 *   bun run ci:workflow
 */

import { join } from "node:path";
import { parseArgs } from "node:util";

interface Check {
  readonly label: string;
  readonly command: readonly string[];
}

const ROOT = join(import.meta.dir, "..");
const CHECKS_AFTER_FORMAT: readonly Check[] = [
  { label: "Typecheck", command: ["bun", "run", "typecheck"] },
  { label: "Lint", command: ["bun", "run", "lint"] },
  { label: "Tests", command: ["bun", "run", "test"] },
];
const WORKFLOW_CHECKS: readonly Check[] = [
  { label: "Format", command: ["bun", "run", "fmt:check"] },
  ...CHECKS_AFTER_FORMAT,
];
const LOCAL_CHECKS: readonly Check[] = [
  { label: "Format", command: ["bun", "run", "fmt"] },
  ...CHECKS_AFTER_FORMAT,
  { label: "Budgets", command: ["bun", "run", "budgets", "--", "--dry-run"] },
  { label: "Site build", command: ["bun", "run", "site:build"] },
];

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    workflow: { type: "boolean", default: false },
  },
  strict: true,
});

const githubActions = process.env.GITHUB_ACTIONS === "true";
const colorForced = process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0";
const useColor =
  colorForced ||
  (process.env.NO_COLOR === undefined && (Boolean(process.stdout.isTTY) || githubActions));
const paint = (code: number, text: string): string =>
  useColor ? `\u001B[${code}m${text}\u001B[0m` : text;
const bold = (text: string): string => paint(1, text);
const dim = (text: string): string => paint(2, text);
const green = (text: string): string => paint(32, text);
const red = (text: string): string => paint(31, text);
const cyan = (text: string): string => paint(36, text);

function duration(startedAt: number): string {
  const elapsed = performance.now() - startedAt;
  return elapsed < 1_000 ? `${Math.round(elapsed)}ms` : `${(elapsed / 1_000).toFixed(1)}s`;
}

function startGroup(title: string): void {
  if (githubActions) {
    console.log(`::group::${title}`);
    return;
  }
  console.log(`\n${cyan("◆")} ${bold(title)}`);
}

function endGroup(): void {
  if (githubActions) {
    console.log("::endgroup::");
  }
}

async function runCheck(check: Check, index: number, total: number): Promise<boolean> {
  const title = `[${index + 1}/${total}] ${check.label}`;
  startGroup(title);
  const startedAt = performance.now();
  const child = Bun.spawn(check.command, {
    cwd: ROOT,
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  endGroup();

  const elapsed = duration(startedAt);
  if (exitCode === 0) {
    console.log(`${green("✓")} ${check.label} ${dim(`(${elapsed})`)}`);
    return true;
  }

  console.error(`${red("✗")} ${check.label} ${dim(`(${elapsed})`)}`);
  if (githubActions) {
    console.error(`::error title=CI failed::${check.label} exited with code ${exitCode}`);
  }
  return false;
}

const checks = values.workflow ? WORKFLOW_CHECKS : LOCAL_CHECKS;
const mode = values.workflow ? "workflow" : "local";
const startedAt = performance.now();

console.log(`\n${bold("OKE CI")} ${dim(`· ${mode} · ${checks.length} checks`)}`);

for (const [index, check] of checks.entries()) {
  if (!(await runCheck(check, index, checks.length))) {
    console.error(`\n${red(bold("CI failed"))} ${dim(`after ${duration(startedAt)}`)}\n`);
    process.exit(1);
  }
}

console.log(
  `\n${green(bold("CI passed"))} ${dim(`· ${checks.length}/${checks.length} checks · ${duration(startedAt)}`)}\n`,
);
