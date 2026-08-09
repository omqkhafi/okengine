/**
 * `oke build --target edge` — tree-shaken kernel profile.
 */

/** Options for {@link runBuild}. */
export interface BuildOptions {
  readonly target?: "bun" | "node" | "edge";
  readonly entry?: string;
  readonly outdir?: string;
  readonly write?: (text: string) => void;
  /** Project root for the `.adopt()` barrel sync (default `process.cwd()`). */
  readonly rootDir?: string;
  /** Inject bun.build (tests). */
  readonly bundle?: (opts: {
    entry: string;
    outdir: string;
    target: "bun" | "node" | "browser";
  }) => Promise<{ success: boolean; logs: string }>;
  /**
   * Inject `.adopt()` barrel regeneration (tests). Default: real
   * `generateAdoptBarrel` + atomic write to `<rootDir>/src/flows/generated.ts`
   * (`generated.ts.tmp` → rename). Returns the unit names written, for the
   * status line.
   */
  readonly syncAdoptBarrel?: (rootDir: string) => Promise<readonly string[]>;
}

/**
 * Regenerate `src/flows/generated.ts` from every `src/flows/<unit>/index.ts`
 * unit folder — pre-step for `oke build` (mirrors `oke db`'s `schema.drizzle.ts`
 * pre-step). A real file on disk, not a virtual module: identical resolution
 * under `oke dev`'s runtime `import()` and `oke build`'s `Bun.build()`
 * (investigated — a virtual-module Bun plugin does not resolve consistently
 * across those two paths). Written atomically so a concurrent reader never
 * sees a torn file.
 *
 * @param rootDir - Project root
 */
async function defaultSyncAdoptBarrel(rootDir: string): Promise<readonly string[]> {
  const { generateAdoptBarrel, writeAdoptBarrel } = await import("../compiler/generate-adopt.ts");
  const { source, units } = await generateAdoptBarrel({ rootDir });
  await writeAdoptBarrel(rootDir, source);
  return units;
}

/**
 * Build a deployable bundle. Edge target aims at the &lt;15 kB kernel budget.
 *
 * @param options - Target / entry
 */
export async function runBuild(options: BuildOptions = {}): Promise<number> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const target = options.target ?? "bun";
  const entry = options.entry ?? "src/app.ts";
  const outdir = options.outdir ?? "dist";
  const rootDir = options.rootDir ?? process.cwd();
  const bunTarget = target === "edge" ? "browser" : target === "node" ? "node" : "bun";

  const bundle =
    options.bundle ??
    (async ({ entry: e, outdir: o, target: t }) => {
      const result = await Bun.build({
        entrypoints: [e],
        outdir: o,
        target: t,
        minify: target === "edge",
        sourcemap: "none",
      });
      return {
        success: result.success,
        logs: result.logs.map((l) => String(l)).join("\n"),
      };
    });
  const syncAdoptBarrel = options.syncAdoptBarrel ?? defaultSyncAdoptBarrel;

  try {
    const units = await syncAdoptBarrel(rootDir);
    write(
      `oke build: .adopt() barrel → src/flows/generated.ts (${units.length} unit${units.length === 1 ? "" : "s"})\n`,
    );
    const result = await bundle({ entry, outdir, target: bunTarget });
    if (!result.success) {
      console.error(result.logs || "oke build: failed");
      return 1;
    }
    write(`oke build: ${target} → ${outdir}\n`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

/**
 * CLI entry for `oke build`.
 *
 * @param args - Args after `build`
 */
export async function buildCli(args: readonly string[]): Promise<number> {
  let target: BuildOptions["target"] = "bun";
  let entry: string | undefined;
  let outdir: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--target" || a === "-t") {
      target = args[++i] as BuildOptions["target"];
    } else if (a === "--entry" || a === "-e") entry = args[++i];
    else if (a === "--outdir" || a === "-o") outdir = args[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`oke build [--target|-t bun|node|edge] [--entry|-e src/app.ts]

Tree-shaken bundle. --target edge aims at the <15 kB kernel budget.
`);
      return 0;
    }
  }
  return runBuild({ target, entry, outdir });
}
