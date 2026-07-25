#!/usr/bin/env bun
/**
 * Doc-drift checker — claimed TypeScript fences in `four-applications.md`
 * must be contained (whitespace-normalized) under `examples/<app>/`.
 *
 * Claimed fences are those under a heading like `### \`path/to/file.ts\``.
 * Unheaded fences are illustrations and are ignored.
 */

import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const SPEC = resolve(ROOT, "docs/spec/four-applications.md");

/** App section heading → example package directory name. */
const APP_SECTIONS: ReadonlyArray<{ readonly re: RegExp; readonly app: string }> =
  [
    { re: /^# 1 · BASIC — Notes\b/m, app: "notes" },
    { re: /^# 2 · INTERMEDIATE — Linkly\b/m, app: "linkly" },
    { re: /^# 3 · ADVANCED — Provisions\b/m, app: "provisions" },
    { re: /^# 4 · COMPLEX — Skyport\b/m, app: "skyport" },
  ];

/**
 * Normalize TypeScript source for containment comparison.
 *
 * @param text - Raw source
 */
export function normalizeTs(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}

/** One claimed fence extracted from the spec. */
export interface ClaimedFence {
  readonly app: string;
  readonly relPath: string;
  readonly body: string;
  readonly headingLine: number;
}

/**
 * Parse claimed fences from four-applications markdown.
 *
 * @param markdown - Spec document
 */
export function parseClaimedFences(markdown: string): ClaimedFence[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const fences: ClaimedFence[] = [];
  let app: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (/^# REFERENCE\b/.test(line) || /^# 5 ·/.test(line)) {
      break;
    }

    for (const section of APP_SECTIONS) {
      if (section.re.test(line)) {
        app = section.app;
        break;
      }
    }

    if (!app) continue;

    const heading = /^### `([^`]+)`/.exec(line);
    if (!heading) continue;

    const relPath = heading[1]!;
    // Find the next fenced typescript (or ts) block.
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() === "") j++;
    const open = lines[j];
    if (!open || !/^```(?:typescript|ts)\s*$/.test(open)) continue;

    j++;
    const bodyLines: string[] = [];
    while (j < lines.length && !lines[j]!.startsWith("```")) {
      bodyLines.push(lines[j]!);
      j++;
    }
    if (j >= lines.length || !lines[j]!.startsWith("```")) {
      throw new Error(
        `doc-drift: unclosed fence after ### \`${relPath}\` (line ${i + 1})`,
      );
    }

    fences.push({
      app,
      relPath,
      body: bodyLines.join("\n"),
      headingLine: i + 1,
    });
    i = j;
  }

  return fences;
}

/**
 * Whether `expected` is contained in a file, or any file under a directory path.
 *
 * @param targetPath - File or directory (`tests/`)
 * @param expected - Normalized fence body
 */
async function containsFence(
  targetPath: string,
  expected: string,
): Promise<boolean> {
  const direct = Bun.file(targetPath);
  if (await direct.exists()) {
    const st = await direct.stat();
    if (st.isFile()) {
      return normalizeTs(await direct.text()).includes(expected);
    }
  }

  // Directory claim (`### \`tests/\``) — any nested file may contain the fence.
  const dirPath = targetPath.endsWith("/")
    ? targetPath.slice(0, -1)
    : targetPath;
  try {
    const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx}");
    for await (const rel of glob.scan({ cwd: dirPath, onlyFiles: true })) {
      const text = await Bun.file(resolve(dirPath, rel)).text();
      if (normalizeTs(text).includes(expected)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Check that every claimed fence is contained in its example file.
 *
 * @param fences - Claimed fences
 * @param root - Repo root
 */
export async function checkDocDrift(
  fences: readonly ClaimedFence[],
  root = ROOT,
): Promise<{ readonly ok: boolean; readonly failures: readonly string[] }> {
  const failures: string[] = [];

  for (const fence of fences) {
    const targetPath = resolve(root, "examples", fence.app, fence.relPath);
    const expected = normalizeTs(fence.body);
    const contained = await containsFence(targetPath, expected);
    if (!contained) {
      const kind = fence.relPath.endsWith("/") ? "directory" : "file";
      failures.push(
        `${fence.app}: ${kind} ${fence.relPath} does not contain claimed fence (spec line ${fence.headingLine})`,
      );
    }
  }

  return { ok: failures.length === 0, failures };
}

async function main(): Promise<number> {
  const markdown = await Bun.file(SPEC).text();
  const fences = parseClaimedFences(markdown);
  if (fences.length === 0) {
    console.error("doc-drift: no claimed fences found");
    return 1;
  }

  const { ok, failures } = await checkDocDrift(fences);
  if (!ok) {
    console.error(`doc-drift: ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  · ${f}`);
    return 1;
  }

  console.log(
    `doc-drift: ok — ${fences.length} claimed fence(s) contained under examples/`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
