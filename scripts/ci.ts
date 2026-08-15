#!/usr/bin/env bun
/**
 * Local pre-push CI -- one sequential gate matching what you run before tagging.
 *
 * Usage:
 *   bun run ci
 */

import { join } from "node:path";

interface Check {
  readonly label: string;
  readonly command: readonly string[];
  readonly env?: Record<string, string>;
}

const ROOT = join(import.meta.dir, "..");
const CHECKS: readonly Check[] = [
  // Budgets first -- cold-start samples need a quiet machine; Format/Lint/
  // Typecheck/Tests heat the CPU and falsely inflate the Bun subprocess probe.
  { label: "Budgets", command: ["bun", "run", "budgets", "--", "--dry-run"] },
  { label: "Format", command: ["bun", "run", "fmt:check"] },
  { label: "Lint", command: ["bun", "run", "lint"] },
  { label: "Typecheck", command: ["bun", "run", "typecheck"] },
  { label: "Tests", command: ["bun", "run", "test"] },
  { label: "Keel example", command: ["bun", "run", "--cwd", "examples/keel", "test"] },
  { label: "Gate", command: ["bun", "run", "gate"] },
  { label: "Site build", command: ["bun", "run", "site:build"] },
];

const ESC = "\x1b";
const useColor = process.env.NO_COLOR === undefined && Boolean(process.stdout.isTTY);
const paint = (code: number, text: string): string =>
  useColor ? `${ESC}[${code}m${text}${ESC}[0m` : text;
const bold = (text: string): string => paint(1, text);
const dim = (text: string): string => paint(2, text);
const green = (text: string): string => paint(32, text);
const red = (text: string): string => paint(31, text);
const cyan = (text: string): string => paint(36, text);

function duration(startedAt: number): string {
  const elapsed = performance.now() - startedAt;
  return elapsed < 1_000 ? `${Math.round(elapsed)}ms` : `${(elapsed / 1_000).toFixed(1)}s`;
}

async function runCheck(check: Check, index: number, total: number): Promise<boolean> {
  console.log(`\n${cyan("*")} ${bold(`[${index + 1}/${total}] ${check.label}`)}`);
  const startedAt = performance.now();
  const child = Bun.spawn(check.command, {
    cwd: ROOT,
    env: { ...process.env, ...check.env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;

  const elapsed = duration(startedAt);
  if (exitCode === 0) {
    console.log(`${green("ok")} ${check.label} ${dim(`(${elapsed})`)}`);
    return true;
  }

  console.error(`${red("fail")} ${check.label} ${dim(`(${elapsed})`)}`);
  return false;
}

const startedAt = performance.now();

console.log(`\n${bold("OKE CI")} ${dim(`local - ${CHECKS.length} checks`)}`);

for (const [index, check] of CHECKS.entries()) {
  if (!(await runCheck(check, index, CHECKS.length))) {
    console.error(`\n${red(bold("CI failed"))} ${dim(`after ${duration(startedAt)}`)}\n`);
    process.exit(1);
  }
}

console.log(
  `\n${green(bold("CI passed"))} ${dim(`${CHECKS.length}/${CHECKS.length} checks - ${duration(startedAt)}`)}\n`,
);
