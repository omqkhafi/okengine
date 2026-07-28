# okengine docs site

Next.js + [Fumadocs](https://fumadocs.dev) documentation site (black/glass theme,
better-auth-style how-tos).

- **Get Started** (`content/docs/get-started/*.mdx`) is hand-authored handbook MDX
  (Introduction → Comparison → Installation → Basic Usage → Deploy).
- **Learn / Elements / Console / …** are **transcluded** from `docs/spec/` via
  `scripts/sync-content.ts` — the site organizes and renders; it does not invent
  facts.
- **Changelog** (`/changelog`) is derived from `docs/changelog.md` — keep that
  file in lockstep with the published `okengine` version.

## Commands

```bash
bun run sync          # regenerate content/docs from specs
bun run dev           # sync + next dev
bun run build         # sync + static export → out/
bun run start         # serve out/
```

From the monorepo root:

```bash
bun run site:dev
bun run site:build
bun run gate             # includes doc-drift for site/content/docs claimed fences
```

## Deployment

`next.config.mjs` sets `output: 'export'`. The build produces a static `out/`
directory — host it anywhere (no cloud lock-in).
