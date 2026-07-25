import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
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
  turbopack: {
    root: import.meta.dirname,
  },
};

export default withMDX(config);
