/**
 * Sync-load package-local modules that Bun.build leaves as runtime requires
 * (not inlined). Bun `src/` first; published `dist/` chunks for `"import"`.
 *
 * Uses Bun APIs (`import.meta.dir`, `import.meta.require`) and try/catch load
 * instead of exists()+require — Bun’s preferred pattern (the exists syscall
 * is an extra round trip).
 */

import { dirname, join } from "node:path";

let cachedRoot: string | undefined;

/**
 * Try a sync `import.meta.require`; return `undefined` only when the file is missing.
 *
 * @typeParam T - Module namespace shape
 * @param path - Absolute module path
 */
function tryRequire<T>(path: string): T | undefined {
  try {
    return import.meta.require(path) as T;
  } catch (err) {
    const code =
      err !== null && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code)
        : undefined;
    if (
      code === "MODULE_NOT_FOUND" ||
      code === "ENOENT" ||
      (err instanceof Error && /Cannot find module|ENOENT/i.test(err.message))
    ) {
      return undefined;
    }
    throw err;
  }
}

/**
 * Walk up from this module to the okengine package root (`package.json` name).
 */
export function okengineRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = import.meta.dir;
  for (let i = 0; i < 12; i++) {
    const pkg = tryRequire<{ name?: string }>(join(dir, "package.json"));
    if (pkg?.name === "okengine") {
      cachedRoot = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("okengine: package root not found from " + import.meta.dir);
}

/**
 * Synchronously load `src/<rel>.ts` (Bun) or published `dist/<distName>.js`.
 *
 * @typeParam T - Module namespace shape
 * @param relSrc - Path under `src/` without extension (e.g. `auth/config`)
 * @param distName - Filename under `dist/` without extension (e.g. `auth-config`)
 */
export function requirePackageModule<T>(relSrc: string, distName: string): T {
  const root = okengineRoot();
  const srcPath = join(root, "src", `${relSrc}.ts`);
  const distPath = join(root, "dist", `${distName}.js`);
  // Bun native TS — prefer source so local `oke` / tests stay on one graph.
  if (typeof Bun !== "undefined") {
    const fromSrc = tryRequire<T>(srcPath);
    if (fromSrc !== undefined) return fromSrc;
  }
  const fromDist = tryRequire<T>(distPath);
  if (fromDist !== undefined) return fromDist;
  const fallback = tryRequire<T>(srcPath);
  if (fallback !== undefined) return fallback;
  throw new Error(`okengine: missing lazy module src/${relSrc}.ts or dist/${distName}.js`);
}
