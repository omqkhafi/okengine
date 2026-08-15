/**
 * Computed `import.meta.require` so Bun.build cannot inline the target.
 * Callers must pass a computed `stem` (e.g. `["list","page"].join("-")`).
 */

/**
 * Sync-load `dir/stem.ts` (Bun src) or `dir/stem.js` (published chunk).
 *
 * @typeParam T - Module namespace
 * @param dir - Directory (`import.meta.dir` or a relative walk)
 * @param stem - Filename without extension
 */
export function lazyRequire<T>(dir: string, stem: string): T {
  const req = (import.meta as ImportMeta & { require?: (id: string) => T }).require!;
  try {
    return req(`${dir}/${stem}.ts`);
  } catch {
    return req(`${dir}/${stem}.js`);
  }
}
