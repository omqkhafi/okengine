/**
 * Modules that must stay off the static `okengine/http` graph.
 *
 * Add a heavy module here when a cold-start regression pulls it in.
 * One list — the import-graph test matches every entry.
 */

/** One forbidden module on the `okengine/http` static graph. */
export interface HttpGraphForbidden {
  /** Stable id. Printed when the build pulls this module in. */
  readonly id: string;
  /**
   * True when `specifier` is this module.
   * Specifiers are Bun metafile input paths and import paths, including externals.
   *
   * @param specifier - Input path or import specifier
   */
  readonly test: (specifier: string) => boolean;
}

/**
 * Forbidden static imports for `okengine/http`.
 * `zod` and the hybrid-search runtime (`search-runtime`) load on first use
 * elsewhere; a static edge puts them on every cold start.
 */
export const HTTP_STATIC_GRAPH_FORBIDDEN: readonly HttpGraphForbidden[] = [
  {
    id: "zod",
    test: (specifier) =>
      specifier === "zod" ||
      specifier.startsWith("zod/") ||
      specifier.includes("node_modules/zod/") ||
      specifier.includes("node_modules/zod@"),
  },
  {
    id: "hybrid-search runtime",
    test: (specifier) =>
      specifier.includes("search-runtime.ts") ||
      specifier.includes("search-runtime.js") ||
      /(^|\/)search-runtime$/.test(specifier),
  },
  {
    id: "fx runtime",
    test: (specifier) =>
      specifier.endsWith("/fx.ts") || specifier.endsWith("/fx.js") || /(^|\/)fx$/.test(specifier),
  },
];

/** Metafile slice this gate reads. */
interface GraphMetafile {
  readonly inputs: Readonly<
    Record<string, { readonly imports?: readonly { readonly path: string }[] }>
  >;
}

/**
 * Ids from {@link HTTP_STATIC_GRAPH_FORBIDDEN} that appear in `specifiers`.
 *
 * @param specifiers - Bundled input paths and import specifiers
 */
export function forbiddenHttpGraphHits(specifiers: readonly string[]): readonly string[] {
  const hits: string[] = [];
  for (const rule of HTTP_STATIC_GRAPH_FORBIDDEN) {
    if (specifiers.some((specifier) => rule.test(specifier))) hits.push(rule.id);
  }
  return hits;
}

/**
 * Static module specifiers for an entry, from a Bun metafile.
 * Includes bundled inputs and every import path (external and dynamic).
 *
 * @param entry - Absolute path to the entry file
 */
export async function readStaticGraphSpecifiers(
  entry = `${import.meta.dir}/../http.ts`,
): Promise<readonly string[]> {
  const result = await Bun.build({
    entrypoints: [entry],
    target: "bun",
    format: "esm",
    metafile: true,
  });
  if (!result.success) {
    throw new Error(`${entry} build failed:\n${result.logs.map(String).join("\n")}`);
  }
  const metafile = result.metafile as GraphMetafile | undefined;
  if (!metafile) throw new Error(`${entry} build returned no metafile`);
  const specifiers = new Set<string>();
  for (const [input, info] of Object.entries(metafile.inputs)) {
    specifiers.add(input);
    for (const imp of info.imports ?? []) specifiers.add(imp.path);
  }
  return [...specifiers];
}
