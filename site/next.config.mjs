import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** Absolute path to this package (`site/`). */
const siteDir = dirname(fileURLToPath(import.meta.url));
/** Monorepo root — owns the single `bun.lock` for workspaces. */
const rootDir = join(siteDir, '..');
const { version: okeVersion } = JSON.parse(
  readFileSync(join(rootDir, 'package.json'), 'utf8'),
);

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_OKE_VERSION: okeVersion,
  },
  // Nested `site/bun.lock` made Turbopack treat `site/app` as the project
  // root and miss `next`. Keep one lockfile at the monorepo root; pin
  // turbopack.root to that root so workspace-hoisted deps resolve.
  turbopack: {
    root: rootDir,
  },
};

export default withMDX(config);
