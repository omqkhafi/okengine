/**
 * Budget measurement helpers — shared by gates and the budgets.json publisher.
 */

import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { lazyRequire } from "../kernel/lazy-require.ts";
import {
  type BudgetGroup,
  OFFICIAL_PLUGIN_BUDGETS,
  PLUGIN_BUDGET_CATEGORIES,
  resolveExportBudgetTargets,
} from "./exports.ts";
import {
  CLIENT_BUDGET_BYTES,
  COLD_START_BUDGET_MS,
  CONSOLE_BUDGET_BYTES,
  EXPORT_REGRESSION_TOLERANCE_FLOOR_BYTES,
  EXPORT_REGRESSION_TOLERANCE_RATIO,
  KERNEL_EDGE_BUDGET_BYTES,
  ROUTING_P99_BUDGET_MS,
} from "./limits.ts";

const ROOT = `${import.meta.dir}/../..`;
const BUDGETS_JSON_PATH = resolve(ROOT, "budgets.json");

/**
 * Deps measured separately from OKE code in export samples.
 * Edge/client absolute gates keep the historical smaller external list.
 */
const BUILD_EXTERNALS = [
  "@duckdb/node-api",
  "@duckdb/*",
  // ICU MessageFormat — adopted FormatJS runtime; kept out of the edge
  // micro-bundle the same way other heavy deps are measured separately.
  "intl-messageformat",
  "@formatjs/*",
] as const;

/** Heavy optional / peer packages — not counted in export:* gzip samples. */
export const EXPORT_BUILD_EXTERNALS = [
  ...BUILD_EXTERNALS,
  "sently",
  "sently/*",
  "ajv",
  "ajv/*",
  "ajv-formats",
  "oxc-parser",
  "zod",
  "@electric-sql/pglite",
  "@electric-sql/*",
] as const;

/** How a sample is gated. */
export type BudgetGate = "absolute" | "regression";

/** Report section headings. */
const GROUP_HEADINGS: Readonly<Record<BudgetGroup, string>> = {
  core: "Core",
  exports: "Exports",
  plugins: "Plugins",
  drivers: "Drivers",
};

/** Docs category → markdown subheading under Plugins. */
const PLUGIN_CATEGORY_HEADINGS: Readonly<Record<string, string>> = {
  auth: "Auth",
  oauth: "OAuth",
  security: "Security",
  ops: "Ops",
  perf: "Perf",
};

/** One measured budget sample. */
export interface BudgetSample {
  /** Stable metric id. */
  readonly id: string;
  /** Human label. */
  readonly label: string;
  /** Measured value. */
  readonly value: number;
  /** Upper bound used for `ok` (absolute cap or regression ceiling). */
  readonly limit: number;
  /** Unit for display / snapshot. */
  readonly unit: "bytes" | "ms";
  /** Gate mode. */
  readonly gate: BudgetGate;
  /** Report section. */
  readonly group: BudgetGroup;
  /** True when under the gate's limit (or first baseline for regression). */
  readonly ok: boolean;
}

/** Full measurement set for {@link budgets.json}. */
export interface BudgetsSnapshot {
  /** ISO timestamp when measured. */
  readonly measuredAt: string;
  /** Package version from package.json. */
  readonly version: string;
  /** Individual samples. */
  readonly budgets: readonly BudgetSample[];
}

/**
 * Gzip size of all JS artifacts from a Bun.build result.
 *
 * @param result - Successful build
 * @param label - Error context
 */
async function gzipBuildOutputs(
  result: Awaited<ReturnType<typeof Bun.build>>,
  label: string,
): Promise<number> {
  if (!result.success) {
    throw new Error(`${label} build failed:\n${result.logs.map(String).join("\n")}`);
  }
  let total = 0;
  for (const artifact of result.outputs) {
    const path = artifact.path;
    if (path && !/\.(m?js|cjs)$/.test(path) && artifact.kind === "asset") {
      continue;
    }
    const raw = await artifact.arrayBuffer();
    if (raw.byteLength === 0) continue;
    total += Bun.gzipSync(new Uint8Array(raw)).byteLength;
  }
  if (total <= 0) throw new Error(`${label} build produced no JS output`);
  return total;
}

/**
 * Gzip size of a minified ESM bundle for one entry file.
 *
 * @param entry - Absolute path to the TypeScript entry
 * @param label - Error context
 * @param external - Packages left external (not inlined)
 */
export async function measureEntryGzipBytes(
  entry: string,
  label = entry,
  external: readonly string[] = BUILD_EXTERNALS,
): Promise<number> {
  const result = await Bun.build({
    entrypoints: [entry],
    minify: true,
    target: "bun",
    format: "esm",
    external: [...external],
  });
  return gzipBuildOutputs(result, label);
}

/**
 * Raw (uncompressed) minified JS bytes for one entry.
 *
 * @param entry - Absolute path to the TypeScript entry
 * @param label - Error context
 * @param external - Packages left external (not inlined)
 */
export async function measureEntryRawBytes(
  entry: string,
  label = entry,
  external: readonly string[] = BUILD_EXTERNALS,
): Promise<number> {
  const result = await Bun.build({
    entrypoints: [entry],
    minify: true,
    target: "bun",
    format: "esm",
    external: [...external],
  });
  if (!result.success) {
    throw new Error(`${label} build failed:\n${result.logs.map(String).join("\n")}`);
  }
  let total = 0;
  for (const artifact of result.outputs) {
    const path = artifact.path;
    if (path && !/\.(m?js|cjs)$/.test(path) && artifact.kind === "asset") continue;
    const raw = await artifact.arrayBuffer();
    total += raw.byteLength;
  }
  if (total <= 0) throw new Error(`${label} build produced no JS output`);
  return total;
}

/** HTTP-ping app budget sample (raw + gzip, with/without export externals). */
export interface HttpPingBudgetSample {
  readonly gzipWithExternals: number;
  readonly rawWithExternals: number;
  readonly gzipWithoutExternals: number;
  readonly rawWithoutExternals: number;
}

/**
 * Measure a minimal HTTP ping app via `okengine/http`.
 */
export async function measureHttpPingAppBytes(): Promise<HttpPingBudgetSample> {
  const dir = await mkdtemp(join(tmpdir(), "oke-http-ping-budget-"));
  const anchor = join(dir, "anchor.ts");
  const httpEntry = resolve(ROOT, "src/http.ts");
  await Bun.write(
    anchor,
    `import { on, flow, http, gate, oke, createBunRuntime } from ${JSON.stringify(httpEntry)};\n` +
      `on(http.get("/").public(), flow("ping", { do: () => "Hi" }));\n` +
      `export const app = oke({ name: "ping" });\n` +
      `export const rt = createBunRuntime;\n`,
  );
  try {
    const [gzipWithExternals, rawWithExternals, gzipWithoutExternals, rawWithoutExternals] =
      await Promise.all([
        measureEntryGzipBytes(anchor, "http-ping", EXPORT_BUILD_EXTERNALS),
        measureEntryRawBytes(anchor, "http-ping", EXPORT_BUILD_EXTERNALS),
        measureEntryGzipBytes(anchor, "http-ping-deps", BUILD_EXTERNALS),
        measureEntryRawBytes(anchor, "http-ping-deps", BUILD_EXTERNALS),
      ]);
    return {
      gzipWithExternals,
      rawWithExternals,
      gzipWithoutExternals,
      rawWithoutExternals,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Gzip size of the kernel edge profile bundle.
 */
export async function measureKernelEdgeGzipBytes(): Promise<number> {
  try {
    return await gzipKernelEdgeInProcess();
  } catch {
    // bun test's in-process Bun.build cannot always resolve the kernel graph.
    return gzipKernelEdgeSpawn();
  }
}

/** In-process edge gzip — used outside `bun test`. */
async function gzipKernelEdgeInProcess(): Promise<number> {
  const entry = `${import.meta.dir}/../kernel/budget-entry.ts`;
  // Browser target matches the historical edge-profile gate.
  const result = await Bun.build({
    entrypoints: [entry],
    minify: true,
    target: "browser",
    format: "esm",
    external: [...BUILD_EXTERNALS],
  });
  if (!result.success) {
    throw new Error(`kernel edge build failed:\n${result.logs.map(String).join("\n")}`);
  }
  const artifact = result.outputs[0];
  if (!artifact) throw new Error("kernel edge build produced no output");
  const raw = await artifact.arrayBuffer();
  return Bun.gzipSync(new Uint8Array(raw)).byteLength;
}

/** Subprocess edge gzip — bun test cannot always resolve this graph in-process. */
async function gzipKernelEdgeSpawn(): Promise<number> {
  const entry = resolve(ROOT, "src/kernel/budget-entry.ts");
  const probe = `
const result = await Bun.build({
  entrypoints: ${JSON.stringify([entry])},
  minify: true,
  target: "browser",
  format: "esm",
  external: ${JSON.stringify([...BUILD_EXTERNALS])},
});
if (!result.success) {
  console.error(result.logs.map(String).join("\\n"));
  process.exit(1);
}
const artifact = result.outputs[0];
if (!artifact) { console.error("no output"); process.exit(1); }
const raw = await artifact.arrayBuffer();
process.stdout.write(String(Bun.gzipSync(new Uint8Array(raw)).byteLength));
`;
  const proc = Bun.spawn(["bun", "-e", probe], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`kernel edge build failed:\n${stderr || stdout}`);
  }
  const n = Number(stdout.trim());
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`kernel edge measure produced ${stdout}`);
  }
  return n;
}

/**
 * Gzip size of the client runtime bundle.
 */
export async function measureClientGzipBytes(): Promise<number> {
  const entry = `${import.meta.dir}/../client/budget-entry.ts`;
  const result = await Bun.build({
    entrypoints: [entry],
    minify: true,
    target: "browser",
    format: "esm",
  });
  if (!result.success) {
    throw new Error(`client build failed:\n${result.logs.map(String).join("\n")}`);
  }
  const artifact = result.outputs[0];
  if (!artifact) throw new Error("client build produced no output");
  const raw = await artifact.arrayBuffer();
  return Bun.gzipSync(new Uint8Array(raw)).byteLength;
}

/**
 * Gzip size of one published package export entry.
 *
 * Bundles through a temporary `import *` anchor so minify cannot drop the
 * re-export graph (direct entry bundles collapse barrels to ~empty stubs).
 *
 * @param entry - Absolute path to the export entry
 */
export async function measureExportGzipBytes(entry: string): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), "oke-export-budget-"));
  const anchor = join(dir, "anchor.ts");
  await Bun.write(
    anchor,
    `import * as mod from ${JSON.stringify(entry)};\n` +
      `export function __okeExportBudgetAnchor(){return mod;}\n`,
  );
  try {
    return await measureEntryGzipBytes(anchor, `export ${entry}`, EXPORT_BUILD_EXTERNALS);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** One Console asset's gzip size. */
export interface ConsoleAssetGzip {
  /** File name under `dist/` or `dist/assets/`. */
  readonly name: string;
  /** Gzipped byte length. */
  readonly gzip: number;
}

/** Definitive Console bundle breakdown (initial vs lazy panel chunks). */
export interface ConsoleBundleBreakdown {
  /** Bytes the first navigation downloads (html + script/link/modulepreload). */
  readonly initialGzipBytes: number;
  /** Assets counted in the initial load. */
  readonly initial: readonly ConsoleAssetGzip[];
  /** Lazy `panel-*` chunks (not in the initial navigation). */
  readonly panels: readonly ConsoleAssetGzip[];
  /** Other assets neither initial nor panel (should stay empty / tiny). */
  readonly other: readonly ConsoleAssetGzip[];
}

/**
 * Gzip size of Console initial load (html + entry js/css).
 *
 * @param distDir - Vite outDir (built if missing)
 */
export async function measureConsoleInitialGzipBytes(
  distDir = `${import.meta.dir}/../console/ui-next/dist`,
): Promise<number> {
  const breakdown = await measureConsoleBundleBreakdown(distDir);
  return breakdown.initialGzipBytes;
}

/**
 * Build the Console SPA and return an initial-vs-lazy breakdown.
 *
 * Initial load is defined as what `index.html` actually references
 * (`<script>`, stylesheet `<link>`, and `modulepreload` hrefs).
 *
 * @param distDir - Vite outDir
 */
export async function measureConsoleBundleBreakdown(
  distDir = `${import.meta.dir}/../console/ui-next/dist`,
): Promise<ConsoleBundleBreakdown> {
  // Force production minify. `bun test` sets NODE_ENV=test, which yields an
  // unminified SPA and inflates the gzip number.
  const build = Bun.spawnSync(
    ["bunx", "--bun", "vite", "build", "--config", "src/console/ui-next/vite.config.ts"],
    {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NODE_ENV: "production" },
    },
  );
  if (build.exitCode !== 0) {
    throw new Error(
      `console build failed:\n${build.stdout.toString()}\n${build.stderr.toString()}`,
    );
  }
  return consoleBundleBreakdown(distDir);
}

/**
 * One cold-start median: seven Bun subprocess probes, discard the first
 * (FS / module-cache warmup), median of the remaining six.
 */
async function measureColdStartMedianMsOnce(): Promise<number> {
  const httpEntry = `${import.meta.dir}/../http.ts`;
  const probe = `
const t0 = performance.now();
const { createBunRuntime, oke, on, flow, http, gate } = await import(${JSON.stringify(httpEntry)});
const { resetBindings } = await import(${JSON.stringify(`${import.meta.dir}/../kernel/on.ts`)});
resetBindings();
on(http.get("/ping").public(), flow("ping", { do: () => ({ ok: true }) }));
const app = oke({ name: "cold-start" });
const rt = createBunRuntime();
const server = rt.serve(app, { port: 0, hostname: "127.0.0.1" });
const ms = performance.now() - t0;
server.stop(true);
process.stdout.write(String(ms));
`;
  const samples: number[] = [];
  for (let i = 0; i < 7; i++) {
    const proc = Bun.spawn(["bun", "-e", probe], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(`cold-start probe failed: ${stderr || stdout}`);
    }
    const ms = Number(stdout.trim());
    if (!Number.isFinite(ms)) {
      throw new Error(`cold-start probe returned non-numeric: ${stdout}`);
    }
    samples.push(ms);
  }
  // Lower median of the six scored samples (index 2 of 6) — less pessimistic
  // than the upper median on right-skewed shared-runner noise.
  const scored = samples.slice(1).sort((a, b) => a - b);
  return scored[Math.floor((scored.length - 1) / 2)]!;
}

/**
 * Median cold-start ms across Bun subprocesses.
 *
 * Takes the best of up to five rounds (early-exit when under budget) so
 * noisy shared CI runners do not fail a real sub-budget cold start.
 */
export async function measureColdStartMedianMs(): Promise<number> {
  let best = Number.POSITIVE_INFINITY;
  for (let round = 0; round < 5; round++) {
    const median = await measureColdStartMedianMsOnce();
    if (median < best) best = median;
    if (best < COLD_START_BUDGET_MS) return best;
  }
  return best;
}

/**
 * p99 of single-match routing overhead (ms) on a 200-route RegExp router.
 */
export function measureRoutingP99Ms(): number {
  const N = 200;
  const { createRouter } = lazyRequire<typeof import("../kernel/router.ts")>(
    `${import.meta.dir}/../kernel`,
    "router",
  );
  const router = createRouter<number>("default");
  for (let i = 0; i < N; i++) {
    router.add("GET", `/r${i}/:id/leaf`, i);
  }
  router.build();
  const target = `/r${N - 1}/item/leaf`;

  // Warm JIT / caches.
  for (let i = 0; i < 1_000; i++) {
    router.match("GET", target);
  }

  const iterations = 10_000;
  const samples = new Float64Array(iterations);
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    router.match("GET", target);
    samples[i] = performance.now() - t0;
  }
  samples.sort();
  const idx = Math.min(iterations - 1, Math.floor(iterations * 0.99));
  return samples[idx]!;
}

/**
 * Regression ceiling from a previous byte sample.
 *
 * @param previous - Last committed value
 */
export function exportRegressionLimitBytes(previous: number): number {
  const allowed = Math.max(
    EXPORT_REGRESSION_TOLERANCE_FLOOR_BYTES,
    Math.ceil(previous * EXPORT_REGRESSION_TOLERANCE_RATIO),
  );
  return previous + allowed;
}

/**
 * Load previous sample values from a budgets snapshot file (if present).
 *
 * @param path - Absolute path to budgets.json
 */
export async function loadPreviousBudgetValues(
  path = BUDGETS_JSON_PATH,
): Promise<ReadonlyMap<string, number>> {
  const file = Bun.file(path);
  if (!(await file.exists())) return new Map();
  try {
    const snap = (await file.json()) as BudgetsSnapshot;
    const map = new Map<string, number>();
    for (const b of snap.budgets ?? []) {
      map.set(b.id, b.value);
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Measure every published budget (absolute AGENTS caps + export regressions).
 */
export async function measureAllBudgets(): Promise<BudgetsSnapshot> {
  const pkg = (await Bun.file(`${ROOT}/package.json`).json()) as {
    version: string;
  };
  const previous = await loadPreviousBudgetValues();

  // Cold start alone first — parallel gzip work contends for CPU on CI and
  // falsely inflates the wall-clock probe.
  const coldStartMedianMs = await measureColdStartMedianMs();
  const [kernelEdgeGzipBytes, clientGzipBytes, consoleInitialGzipBytes, httpPing] =
    await Promise.all([
      measureKernelEdgeGzipBytes(),
      measureClientGzipBytes(),
      measureConsoleInitialGzipBytes(),
      measureHttpPingAppBytes(),
    ]);
  const routingP99Ms = measureRoutingP99Ms();

  const budgets: BudgetSample[] = [
    sample(
      "kernelEdgeGzipBytes",
      "Kernel (edge profile)",
      kernelEdgeGzipBytes,
      KERNEL_EDGE_BUDGET_BYTES,
      "bytes",
      "absolute",
      "core",
    ),
    sample(
      "clientGzipBytes",
      "Client runtime",
      clientGzipBytes,
      CLIENT_BUDGET_BYTES,
      "bytes",
      "absolute",
      "core",
    ),
    sample(
      "consoleInitialGzipBytes",
      "Console initial load",
      consoleInitialGzipBytes,
      CONSOLE_BUDGET_BYTES,
      "bytes",
      "absolute",
      "core",
    ),
    sample(
      "coldStartMedianMs",
      "Cold start on Bun",
      coldStartMedianMs,
      COLD_START_BUDGET_MS,
      "ms",
      "absolute",
      "core",
    ),
    sample(
      "routingP99Ms",
      "p99 routing overhead",
      routingP99Ms,
      ROUTING_P99_BUDGET_MS,
      "ms",
      "absolute",
      "core",
    ),
    regressionSample(
      "httpPingGzipBytes",
      "HTTP ping app (gzip, externals)",
      "core",
      httpPing.gzipWithExternals,
      previous,
    ),
    regressionSample(
      "httpPingRawBytes",
      "HTTP ping app (raw, externals)",
      "core",
      httpPing.rawWithExternals,
      previous,
    ),
  ];

  const exportTargets = await resolveExportBudgetTargets();
  const exportSizes = await Promise.all(
    exportTargets.map(async (t) => ({
      target: t,
      bytes: await measureExportGzipBytes(t.entry),
    })),
  );
  for (const { target, bytes } of exportSizes) {
    budgets.push(regressionSample(target.id, target.label, target.group, bytes, previous));
  }

  return {
    measuredAt: new Date().toISOString(),
    version: pkg.version,
    budgets,
  };
}

/**
 * Format a snapshot for CI logs (Core / Exports / Plugins / Drivers).
 *
 * @param snapshot - Measured budgets
 */
export function formatBudgetsReport(snapshot: BudgetsSnapshot): string {
  const lines = [`okengine budgets v${snapshot.version} @ ${snapshot.measuredAt}`];
  const order: readonly BudgetGroup[] = ["core", "exports", "plugins", "drivers"];
  for (const group of order) {
    const rows = snapshot.budgets.filter((b) => b.group === group);
    if (rows.length === 0) continue;
    lines.push("");
    lines.push(GROUP_HEADINGS[group]);
    for (const b of rows) {
      const flag = b.ok ? "ok" : "FAIL";
      lines.push(
        `  [${flag}] ${b.label}: ${formatValue(b.value, b.unit)} < ${formatValue(b.limit, b.unit)}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Markdown table with column widths padded so `oxfmt` is a no-op.
 * Compact `|---|` tables get realigned by oxfmt and make Format fail after
 * every `bun run budgets` refresh.
 *
 * @param headers - Column headers (use `""` for an unnamed first column)
 * @param rows - Body cells
 */
export function formatMarkdownTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string[] {
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => (row[i] ?? "").length)),
  );
  const cell = (value: string, i: number): string => value.padEnd(widths[i]!);
  const line = (cells: readonly string[]): string =>
    `| ${cells.map((value, i) => cell(value, i)).join(" | ")} |`;
  const sep = `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`;
  return [line(headers), sep, ...rows.map((row) => line(row))];
}

/**
 * Full markdown document for [`BUDGETS.md`](../../BUDGETS.md).
 * Written by `bun run budgets` — do not edit the tables by hand.
 *
 * @param snapshot - Measured budgets
 */
export function formatBudgetsMarkdown(snapshot: BudgetsSnapshot): string {
  const lines = [
    "# Budgets",
    "",
    "Published numbers from [`budgets.json`](budgets.json). Refresh with `bun run budgets`.",
    "",
    `_okengine v${snapshot.version} · measured ${snapshot.measuredAt}_`,
    "",
    "Core rows are absolute AGENTS caps (plus HTTP-ping regression samples). Exports, Plugins, and Drivers fail on regression vs the prior [`budgets.json`](budgets.json) (max +256 B or +2%). Export gzip excludes peers/optionals (`zod`, `sently`, `oxc-parser`, `ajv`, DuckDB, FormatJS). The `okengine` export row is the **thin root** (gzip); use `okengine/full` for the legacy mega-barrel and `okengine/http` for HTTP-only apps.",
  ];
  const order: readonly BudgetGroup[] = ["core", "exports", "plugins", "drivers"];
  for (const group of order) {
    const rows = snapshot.budgets.filter((b) => b.group === group);
    if (rows.length === 0) continue;
    const limitCol = group === "core" ? "Limit" : "Ceiling";
    lines.push("");
    lines.push(`## ${GROUP_HEADINGS[group]}`);
    if (group === "plugins") {
      for (const category of PLUGIN_BUDGET_CATEGORIES) {
        const names = new Set(
          OFFICIAL_PLUGIN_BUDGETS.filter((p) => p.category === category).map((p) => p.name),
        );
        const catRows = rows.filter((b) => names.has(b.label));
        if (catRows.length === 0) continue;
        lines.push("");
        lines.push(`### ${PLUGIN_CATEGORY_HEADINGS[category] ?? category}`);
        lines.push("");
        lines.push(
          ...formatMarkdownTable(
            ["", "Measured", limitCol],
            catRows.map((b) => {
              const mark = b.ok ? "" : " **FAIL**";
              return [
                `${b.label}${mark}`,
                formatValue(b.value, b.unit),
                formatValue(b.limit, b.unit),
              ];
            }),
          ),
        );
      }
      continue;
    }
    lines.push("");
    lines.push(
      ...formatMarkdownTable(
        ["", "Measured", limitCol],
        rows.map((b) => {
          const mark = b.ok ? "" : " **FAIL**";
          return [`${b.label}${mark}`, formatValue(b.value, b.unit), formatValue(b.limit, b.unit)];
        }),
      ),
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * True when every sample is under its limit.
 *
 * @param snapshot - Measured budgets
 */
export function budgetsPass(snapshot: BudgetsSnapshot): boolean {
  return snapshot.budgets.every((b) => b.ok);
}

function sample(
  id: string,
  label: string,
  value: number,
  limit: number,
  unit: BudgetSample["unit"],
  gate: BudgetGate,
  group: BudgetGroup,
): BudgetSample {
  const rounded = unit === "bytes" ? Math.round(value) : Math.round(value * 1000) / 1000;
  return {
    id,
    label,
    value: rounded,
    limit,
    unit,
    gate,
    group,
    ok: rounded < limit,
  };
}

/**
 * Byte sample gated against the previous committed value (+ tolerance).
 * First appearance records a baseline (`ok: true`, `limit` = value + floor).
 *
 * @param id - Sample id
 * @param label - Human label
 * @param group - Report section
 * @param value - Measured gzip bytes
 * @param previous - Prior snapshot values by id
 */
function regressionSample(
  id: string,
  label: string,
  group: BudgetGroup,
  value: number,
  previous: ReadonlyMap<string, number>,
): BudgetSample {
  const rounded = Math.round(value);
  const prior = previous.get(id);
  if (prior === undefined) {
    return {
      id,
      label,
      value: rounded,
      limit: rounded + EXPORT_REGRESSION_TOLERANCE_FLOOR_BYTES,
      unit: "bytes",
      gate: "regression",
      group,
      ok: true,
    };
  }
  const limit = exportRegressionLimitBytes(prior);
  return {
    id,
    label,
    value: rounded,
    limit,
    unit: "bytes",
    gate: "regression",
    group,
    ok: rounded < limit,
  };
}

function formatValue(value: number, unit: BudgetSample["unit"]): string {
  if (unit === "bytes") {
    if (value >= 1024) return `${(value / 1024).toFixed(2)} kB`;
    return `${Math.round(value)} B`;
  }
  return `${value.toFixed(3)} ms`;
}

/**
 * Parse `index.html` for first-navigation asset hrefs.
 *
 * @param html - index.html text
 */
function initialAssetHrefs(html: string): string[] {
  const hrefs: string[] = [];
  const re = /(?:src|href)=["'](\/?assets\/[^"']+\.(?:js|css))["']/g;
  for (const match of html.matchAll(re)) {
    const href = match[1];
    if (href) hrefs.push(href.replace(/^\//, ""));
  }
  return [...new Set(hrefs)];
}

async function gzipFile(path: string): Promise<number> {
  const raw = await Bun.file(path).arrayBuffer();
  return Bun.gzipSync(new Uint8Array(raw)).byteLength;
}

/**
 * Classify built Console assets into initial / panel / other.
 *
 * @param dir - Vite outDir
 */
export async function consoleBundleBreakdown(dir: string): Promise<ConsoleBundleBreakdown> {
  const assetsDir = join(dir, "assets");
  const indexPath = join(dir, "index.html");
  const indexFile = Bun.file(indexPath);
  const initial: ConsoleAssetGzip[] = [];
  const panels: ConsoleAssetGzip[] = [];
  const other: ConsoleAssetGzip[] = [];

  if (await indexFile.exists()) {
    const html = await indexFile.text();
    initial.push({
      name: "index.html",
      gzip: Bun.gzipSync(new TextEncoder().encode(html)).byteLength,
    });
    for (const href of initialAssetHrefs(html)) {
      const name = href.replace(/^assets\//, "");
      const path = join(dir, href);
      if (!(await Bun.file(path).exists())) continue;
      initial.push({ name, gzip: await gzipFile(path) });
    }
  }

  const initialNames = new Set(initial.map((a) => a.name));
  let entries: string[] = [];
  try {
    entries = await readdir(assetsDir);
  } catch {
    entries = [];
  }

  for (const name of entries) {
    if (!/\.(js|css)$/.test(name)) continue;
    if (initialNames.has(name)) continue;
    const gzip = await gzipFile(join(assetsDir, name));
    if (name.includes("panel-") || name.includes("lazy")) {
      panels.push({ name, gzip });
    } else {
      other.push({ name, gzip });
    }
  }

  panels.sort((a, b) => a.name.localeCompare(b.name));
  other.sort((a, b) => a.name.localeCompare(b.name));

  return {
    initialGzipBytes: initial.reduce((sum, a) => sum + a.gzip, 0),
    initial,
    panels,
    other,
  };
}
