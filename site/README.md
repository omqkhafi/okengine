# okengine docs site

Next.js + [Fumadocs](https://fumadocs.dev) documentation site (black/glass theme,
better-auth-style how-tos).

- Handbook content lives directly under `content/docs/`.
- **Changelog** (`/changelog`) is derived from the root `changelog.md` — keep that
  file in lockstep with the published `okengine` version.

## Commands

```bash
bun run dev           # Next development server
bun run build         # static export → out/
bun run start         # serve out/
```

From the monorepo root:

```bash
bun run site:dev
bun run site:build
```

## Deployment

`next.config.mjs` sets `output: 'export'` for production builds only (so
`next dev` can 404 unknown docs paths instead of throwing). The build
produces a static `out/` directory — host it anywhere (no cloud lock-in).
