/**
 * Budget measurement helpers — shared by gates and the budgets.json publisher.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createRouter } from "../kernel/router.ts";
import {
  CLIENT_BUDGET_BYTES,
  COLD_START_BUDGET_MS,
  CONSOLE_BUDGET_BYTES,
  KERNEL_EDGE_BUDGET_BYTES,
  ROUTING_P99_BUDGET_MS,
} from "./limits.ts";

const ROOT = `${import.meta.dir}/../..`;

/** One measured budget sample. */
export interface BudgetSample {
  /** Stable metric id. */
  readonly id: string;
  /** Human label. */
  readonly label: string;
  /** Measured value. */
  readonly value: number;
  /** Hard limit (exclusive upper bound). */
  readonly limit: number;
  /** Unit for display / snapshot. */
  readonly unit: "bytes" | "ms";
  /** True when `value < limit`. */
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
 * Gzip size of the kernel edge profile bundle.
 */
export async function measureKernelEdgeGzipBytes(): Promise<number> {
  const entry = `${import.meta.dir}/../kernel/budget-entry.ts`;
  const result = await Bun.build({
    entrypoints: [entry],
    minify: true,
    target: "browser",
    format: "esm",
    // Optional native drivers stay out of the edge profile.
    external: ["@duckdb/node-api", "@duckdb/*"],
  });
  if (!result.success) {
    throw new Error(
      `kernel edge build failed:\n${result.logs.map(String).join("\n")}`,
    );
  }
  const artifact = result.outputs[0];
  if (!artifact) throw new Error("kernel edge build produced no output");
  const raw = await artifact.arrayBuffer();
  return Bun.gzipSync(new Uint8Array(raw)).byteLength;
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
    throw new Error(
      `client build failed:\n${result.logs.map(String).join("\n")}`,
    );
  }
  const artifact = result.outputs[0];
  if (!artifact) throw new Error("client build produced no output");
  const raw = await artifact.arrayBuffer();
  return Bun.gzipSync(new Uint8Array(raw)).byteLength;
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
  distDir = `${import.meta.dir}/../console/ui/dist`,
): Promise<number> {
  const breakdown = await measureConsoleBundleBreakdown(distDir);
  return breakdown.initialGzipBytes;
}

/**
 * Build the Console SPA and return an initial-vs-lazy breakdown.
 *
 * Initial load is defined as what `index.html` actually references
 * (`<script>`, stylesheet `<link>`, and `modulepreload` hrefs) — not
 * "every asset whose filename lacks `panel-`". That earlier heuristic
 * mis-counted Overview/Gates/Channels lazy chunks and inflated the number.
 *
 * @param distDir - Vite outDir
 */
export async function measureConsoleBundleBreakdown(
  distDir = `${import.meta.dir}/../console/ui/dist`,
): Promise<ConsoleBundleBreakdown> {
  // Force production minify. `bun test` sets NODE_ENV=test, which yields an
  // unminified SPA (~136 kB gzip) and was the unexplained Prompt-21 (≈90 kB)
  // vs later (~138 kB) gap — methodology, not a panel leak.
  const build = Bun.spawnSync(
    ["bunx", "vite", "build", "--config", "src/console/ui/vite.config.ts"],
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
 * Median cold-start ms across three Bun subprocesses.
 */
export async function measureColdStartMedianMs(): Promise<number> {
  const paths = {
    bun: `${import.meta.dir}/../runtime/bun.ts`,
    app: `${import.meta.dir}/../kernel/app.ts`,
    flow: `${import.meta.dir}/../kernel/flow.ts`,
    on: `${import.meta.dir}/../kernel/on.ts`,
    http: `${import.meta.dir}/../kernel/triggers.ts`,
  };
  const probe = `
const t0 = performance.now();
const { createBunRuntime } = await import(${JSON.stringify(paths.bun)});
const { oke } = await import(${JSON.stringify(paths.app)});
const { flow } = await import(${JSON.stringify(paths.flow)});
const { on, resetBindings } = await import(${JSON.stringify(paths.on)});
const { http } = await import(${JSON.stringify(paths.http)});
resetBindings();
on(http.get("/ping"), flow({ name: "ping", do: () => ({ ok: true }) }));
const app = oke({ name: "cold-start" });
const rt = createBunRuntime();
const server = rt.serve(app, { port: 0, hostname: "127.0.0.1" });
const ms = performance.now() - t0;
server.stop(true);
process.stdout.write(String(ms));
`;
  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
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
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

/**
 * p99 of single-match routing overhead (ms) on a 200-route RegExp router.
 */
export function measureRoutingP99Ms(): number {
  const N = 200;
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
 * Measure every published budget.
 */
export async function measureAllBudgets(): Promise<BudgetsSnapshot> {
  const pkg = (await Bun.file(`${ROOT}/package.json`).json()) as {
    version: string;
  };
  const [
    kernelEdgeGzipBytes,
    clientGzipBytes,
    consoleInitialGzipBytes,
    coldStartMedianMs,
  ] = await Promise.all([
    measureKernelEdgeGzipBytes(),
    measureClientGzipBytes(),
    measureConsoleInitialGzipBytes(),
    measureColdStartMedianMs(),
  ]);
  const routingP99Ms = measureRoutingP99Ms();

  const budgets: BudgetSample[] = [
    sample(
      "kernelEdgeGzipBytes",
      "Kernel (edge profile)",
      kernelEdgeGzipBytes,
      KERNEL_EDGE_BUDGET_BYTES,
      "bytes",
    ),
    sample(
      "clientGzipBytes",
      "Client runtime",
      clientGzipBytes,
      CLIENT_BUDGET_BYTES,
      "bytes",
    ),
    sample(
      "consoleInitialGzipBytes",
      "Console initial load",
      consoleInitialGzipBytes,
      CONSOLE_BUDGET_BYTES,
      "bytes",
    ),
    sample(
      "coldStartMedianMs",
      "Cold start on Bun",
      coldStartMedianMs,
      COLD_START_BUDGET_MS,
      "ms",
    ),
    sample(
      "routingP99Ms",
      "p99 routing overhead",
      routingP99Ms,
      ROUTING_P99_BUDGET_MS,
      "ms",
    ),
  ];

  return {
    measuredAt: new Date().toISOString(),
    version: pkg.version,
    budgets,
  };
}

/**
 * Format a snapshot for CI logs.
 *
 * @param snapshot - Measured budgets
 */
export function formatBudgetsReport(snapshot: BudgetsSnapshot): string {
  const lines = [
    `okengine budgets v${snapshot.version} @ ${snapshot.measuredAt}`,
  ];
  for (const b of snapshot.budgets) {
    const flag = b.ok ? "ok" : "FAIL";
    lines.push(
      `  [${flag}] ${b.label}: ${formatValue(b.value, b.unit)} < ${formatValue(b.limit, b.unit)}`,
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
): BudgetSample {
  const rounded =
    unit === "bytes" ? Math.round(value) : Math.round(value * 1000) / 1000;
  return { id, label, value: rounded, limit, unit, ok: rounded < limit };
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
  const re =
    /(?:src|href)=["'](\/?assets\/[^"']+\.(?:js|css))["']/g;
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
export async function consoleBundleBreakdown(
  dir: string,
): Promise<ConsoleBundleBreakdown> {
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
