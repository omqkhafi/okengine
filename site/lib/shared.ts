/** Product name shown in nav and homepage. */
export const appName = "okengine";

/** Docs base path. */
export const docsRoute = "/docs";

/** OG image route prefix. */
export const docsImageRoute = "/og/docs";

/** Per-page markdown route prefix for agents. */
export const docsContentRoute = "/llms.mdx/docs";

/** GitHub coordinates for Edit / source links. */
export const gitConfig = {
  user: "omqkhafi",
  repo: "okengine",
  branch: "main",
} as const;

/** Published package page on npm. */
export const npmPackageUrl = "https://www.npmjs.com/package/okengine";

/** Scaffolding CLI on npm (`bunx create-oke@latest`). */
export const createOkeNpmUrl = "https://www.npmjs.com/package/create-oke";

/** Canonical GitHub repository URL. */
export const githubRepoUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

/** Published package on JSR (`jsr add @omqkhafi/okengine`). */
export const jsrPackageUrl = `https://jsr.io/@${gitConfig.user}/${gitConfig.repo}`;

/** Public X profile for the project. */
export const xProfileUrl = "https://x.com/omqkhafi";

/** Homepage Open Graph image (same 1200×630 pipeline as docs OG). */
export const homepageOgPath = "/og/home";

/**
 * Build a blob URL for a repo-relative path.
 *
 * @param path - Path from repo root (e.g. `docs/spec/unified-theory.md`)
 */
export function githubBlobUrl(path: string): string {
  return `https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/${path}`;
}
