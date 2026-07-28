#!/usr/bin/env bun
/**
 * Doc-drift checker — claimed TypeScript fences in markdown docs must be
 * contained (whitespace-normalized) under `examples/<app>/`.
 *
 * Claimed fences are those under a heading like `### \`path/to/file.ts\``
 * (relative, under an app section in four-applications.md) or
 * `### \`examples/<app>/path/to/file.ts\`` (absolute from repo root — used by
 * README.md). Unheaded fences are illustrations and are ignored.
 *
 * Also validates ```mermaid fences with Mermaid's own parser (happy-dom
 * provides the DOM surface Bun needs for sanitize hooks).
 *
 * Usage:
 *   bun src/cli/doc-drift.ts
 *   bun src/cli/doc-drift.ts docs/spec/four-applications.md README.md
 *   bun src/cli/doc-drift.ts site/content/docs/learn/notes.md
 *
 * Default paths: four-applications.md, README.md, and every markdown/MDX file
 * under site/content/docs (claimed fences only — prose-only pages skip).
 */

import { resolve } from "node:path";
import { Window } from "happy-dom";

const ROOT = resolve(import.meta.dir, "../..");

/**
 * Discover site content markdown that may contain claimed fences.
 *
 * @param root - Repo root
 */
async function discoverSiteDocs(root: string): Promise<string[]> {
  const docsDir = resolve(root, "site/content/docs");
  const out: string[] = [];
  try {
    const glob = new Bun.Glob("**/*.{md,mdx}");
    for await (const rel of glob.scan({ cwd: docsDir, onlyFiles: true })) {
      out.push(resolve(docsDir, rel));
    }
  } catch {
    // site/ not present yet — skip
  }
  return out.sort();
}

/** Core docs that must contain claimed fences. */
const REQUIRED_DOCS: readonly string[] = [
  resolve(ROOT, "docs/spec/four-applications.md"),
  resolve(ROOT, "README.md"),
];

let mermaidReady: Promise<typeof import("mermaid").default> | undefined;

/**
 * Install a minimal DOM so Mermaid's sanitize hooks can run under Bun.
 */
function ensureDom(): void {
  const g = globalThis as typeof globalThis & { document?: unknown };
  if (g.document !== undefined) return;
  const window = new Window({ url: "https://localhost/" });
  Object.assign(g, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    DOMParser: window.DOMParser,
    navigator: window.navigator,
    getComputedStyle: window.getComputedStyle.bind(window),
  });
}

/**
 * Lazy-load Mermaid after the DOM polyfill is in place.
 */
async function loadMermaid(): Promise<typeof import("mermaid").default> {
  ensureDom();
  mermaidReady ??= import("mermaid").then((m) => m.default);
  return mermaidReady;
}

/** App section heading → example package directory name. */
const APP_SECTIONS: ReadonlyArray<{ readonly re: RegExp; readonly app: string }> = [
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
  // Collapse all whitespace so claimed fences match sources regardless of
  // indent (e.g. oxfmt-formatted bodies inside `test(...)` callbacks).
  return text.replace(/\s+/g, " ").trim();
}

/** One claimed fence extracted from a markdown document. */
export interface ClaimedFence {
  readonly app: string;
  readonly relPath: string;
  readonly body: string;
  readonly headingLine: number;
}

/** One ```mermaid fence extracted from a markdown document. */
export interface MermaidFence {
  readonly body: string;
  readonly startLine: number;
}

/**
 * Extract every fenced Mermaid diagram from a markdown document.
 *
 * @param markdown - Spec or README document
 */
export function parseMermaidFences(markdown: string): MermaidFence[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const fences: MermaidFence[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!/^```mermaid\s*$/.test(lines[i]!)) continue;
    const startLine = i + 1;
    i++;
    const bodyLines: string[] = [];
    while (i < lines.length && !lines[i]!.startsWith("```")) {
      bodyLines.push(lines[i]!);
      i++;
    }
    if (i >= lines.length || !lines[i]!.startsWith("```")) {
      throw new Error(`doc-drift: unclosed mermaid fence (line ${startLine})`);
    }
    fences.push({ body: bodyLines.join("\n").trim(), startLine });
  }

  return fences;
}

/**
 * Validate Mermaid fence bodies with Mermaid's parser.
 *
 * @param fences - Extracted mermaid fences
 */
export async function checkMermaidSyntax(
  fences: readonly MermaidFence[],
): Promise<{ readonly ok: boolean; readonly failures: readonly string[] }> {
  if (fences.length === 0) {
    return { ok: true, failures: [] };
  }

  const mermaid = await loadMermaid();
  const failures: string[] = [];

  for (const fence of fences) {
    try {
      const result = await mermaid.parse(fence.body);
      if (!result) {
        failures.push(`mermaid: parse returned false (line ${fence.startLine})`);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      failures.push(`mermaid: invalid syntax (line ${fence.startLine}): ${detail.split("\n")[0]}`);
    }
  }

  return { ok: failures.length === 0, failures };
}

/**
 * Read the typescript/ts fence immediately after a heading line.
 *
 * @param lines - Document lines
 * @param headingIndex - Index of the `### \`…\`` heading
 * @param relPath - Path shown in the heading (for error messages)
 */
function readFenceAfterHeading(
  lines: readonly string[],
  headingIndex: number,
  relPath: string,
): { readonly body: string; readonly endIndex: number } | undefined {
  let j = headingIndex + 1;
  while (j < lines.length && lines[j]!.trim() === "") j++;
  const open = lines[j];
  if (!open || !/^```(?:typescript|ts)\s*$/.test(open)) return undefined;

  j++;
  const bodyLines: string[] = [];
  while (j < lines.length && !lines[j]!.startsWith("```")) {
    bodyLines.push(lines[j]!);
    j++;
  }
  if (j >= lines.length || !lines[j]!.startsWith("```")) {
    throw new Error(
      `doc-drift: unclosed fence after ### \`${relPath}\` (line ${headingIndex + 1})`,
    );
  }

  return { body: bodyLines.join("\n"), endIndex: j };
}

/**
 * Parse claimed fences from a markdown document.
 *
 * Supports (1) app-section context + relative `### \`src/…\`` headings
 * (four-applications.md) and (2) absolute `### \`examples/<app>/…\`` headings
 * (README.md). Stops at `# REFERENCE` / `# 5 ·` as in the four-apps spec.
 *
 * @param markdown - Spec or README document
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

    const heading = /^### `([^`]+)`/.exec(line);
    if (!heading) continue;

    const claimedPath = heading[1]!;
    const examplesMatch = /^examples\/([^/]+)\/(.+)$/.exec(claimedPath);

    let fenceApp: string | undefined;
    let relPath: string;

    if (examplesMatch) {
      fenceApp = examplesMatch[1]!;
      relPath = examplesMatch[2]!;
    } else if (app) {
      fenceApp = app;
      relPath = claimedPath;
    } else {
      continue;
    }

    const fence = readFenceAfterHeading(lines, i, claimedPath);
    if (!fence) continue;

    fences.push({
      app: fenceApp,
      relPath,
      body: fence.body,
      headingLine: i + 1,
    });
    i = fence.endIndex;
  }

  return fences;
}

/**
 * Whether `expected` is contained in a file, or any file under a directory path.
 *
 * @param targetPath - File or directory (`tests/`)
 * @param expected - Normalized fence body
 */
async function containsFence(targetPath: string, expected: string): Promise<boolean> {
  const direct = Bun.file(targetPath);
  if (await direct.exists()) {
    const st = await direct.stat();
    if (st.isFile()) {
      return normalizeTs(await direct.text()).includes(expected);
    }
  }

  // Directory claim (`### \`tests/\``) — any nested file may contain the fence.
  const dirPath = targetPath.endsWith("/") ? targetPath.slice(0, -1) : targetPath;
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

/**
 * Run doc-drift over one or more markdown files.
 *
 * Site content under `site/` may have zero claimed fences (prose-only pages);
 * only `docs/spec/four-applications.md` and `README.md` require at least one.
 *
 * @param paths - Absolute or repo-relative markdown paths
 */
export async function runDocDrift(
  paths: readonly string[],
): Promise<{ readonly ok: boolean; readonly messages: readonly string[] }> {
  const messages: string[] = [];
  let ok = true;
  let total = 0;
  let mermaidTotal = 0;
  let checkedFiles = 0;

  for (const path of paths) {
    const abs = resolve(ROOT, path);
    const label = abs.startsWith(ROOT + "/") ? abs.slice(ROOT.length + 1) : abs;
    const requireClaimed = !label.startsWith("site/");
    const markdown = await Bun.file(abs).text();
    const fences = parseClaimedFences(markdown);
    if (fences.length === 0) {
      if (requireClaimed) {
        messages.push(`doc-drift: no claimed fences found in ${label}`);
        ok = false;
      }
    } else {
      checkedFiles++;
      const result = await checkDocDrift(fences);
      total += fences.length;
      if (!result.ok) {
        ok = false;
        messages.push(`doc-drift: ${result.failures.length} failure(s) in ${label}`);
        for (const f of result.failures) messages.push(`  · ${f}`);
      } else {
        messages.push(`doc-drift: ok — ${fences.length} claimed fence(s) in ${label}`);
      }
    }

    const mermaidFences = parseMermaidFences(markdown);
    if (mermaidFences.length > 0) {
      mermaidTotal += mermaidFences.length;
      const mermaidResult = await checkMermaidSyntax(mermaidFences);
      if (!mermaidResult.ok) {
        ok = false;
        messages.push(`doc-drift: ${mermaidResult.failures.length} mermaid failure(s) in ${label}`);
        for (const f of mermaidResult.failures) messages.push(`  · ${f}`);
      } else {
        messages.push(`doc-drift: ok — ${mermaidFences.length} mermaid fence(s) in ${label}`);
      }
    }
  }

  if (ok && checkedFiles > 1) {
    const mermaidNote = mermaidTotal > 0 ? ` · ${mermaidTotal} mermaid fence(s)` : "";
    messages.push(
      `doc-drift: ok — ${total} claimed fence(s) across ${checkedFiles} file(s)${mermaidNote}`,
    );
  }

  return { ok, messages };
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const paths = args.length > 0 ? args : [...REQUIRED_DOCS, ...(await discoverSiteDocs(ROOT))];
  const { ok, messages } = await runDocDrift(paths);
  for (const m of messages) {
    if (ok) console.log(m);
    else console.error(m);
  }
  return ok ? 0 : 1;
}

if (import.meta.main) {
  process.exit(await main());
}
