import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** Absolute path to this package (`site/`). */
const siteDir = dirname(fileURLToPath(import.meta.url));
/** Monorepo root — owns the single `bun.lock` for workspaces. */
const rootDir = join(siteDir, "..");
const { version: okeVersion } = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));

/** @type {import('next').NextConfig} */
const config = {
  // Do not set `output: "export"`: `proxy.ts` negotiates `Accept: text/markdown`,
  // and that file convention does not run on a static export (Next.js).
  reactStrictMode: true,
  // Dev binds as `localhost`; browsing via `http://127.0.0.1` is a different
  // origin, so Next blocks `/_next/*` unless this host is allowlisted.
  allowedDevOrigins: ["127.0.0.1"],
  // Chrome / Cursor DevTools probe this origin as CDP (`GET /json/version`).
  logging: {
    incomingRequests: {
      ignore: [/\/json(?:\/|$)/],
    },
  },
  env: {
    NEXT_PUBLIC_OKE_VERSION: okeVersion,
  },
  // TypeScript 7 drops the JS compiler API Next uses by default; run the
  // project-local `tsc` CLI instead (required for `typescript@^7`).
  experimental: {
    useTypeScriptCli: true,
  },
  // CLI checker typechecks the whole tsconfig project — keep Bun test files
  // out of `next build` while leaving them in the default `tsconfig.json`.
  typescript: {
    tsconfigPath: "tsconfig.build.json",
  },
  // Nested `site/bun.lock` made Turbopack treat `site/app` as the project
  // root and miss `next`. Keep one lockfile at the monorepo root; pin
  // turbopack.root to that root so workspace-hoisted deps resolve.
  turbopack: {
    root: rootDir,
  },
  async redirects() {
    return [
      {
        source: "/docs/elements/flow/jobs",
        destination: "/docs/elements/flow/consumers",
        permanent: true,
      },
      {
        source: "/docs/recipes/llama-cpp",
        destination: "/docs/recipes/local-ai",
        permanent: true,
      },
      {
        source: "/docs/recipes/vllm",
        destination: "/docs/recipes/local-ai",
        permanent: true,
      },
      {
        source: "/docs/recipes/sglang",
        destination: "/docs/recipes/local-ai",
        permanent: true,
      },
      {
        source: "/docs/recipes/openai-compatible-local",
        destination: "/docs/recipes/local-ai",
        permanent: true,
      },
      {
        source: "/docs/recipes/openai-compatible",
        destination: "/docs/recipes/local-ai",
        permanent: true,
      },
      {
        source: "/docs/recipes/ollama",
        destination: "/docs/recipes/local-ai",
        permanent: true,
      },
    ];
  },
};

export default withMDX(config);
