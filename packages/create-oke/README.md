# create-oke

Scaffold an [okengine](https://www.npmjs.com/package/okengine) app.

```bash
bunx create-oke@latest my-app
cd my-app
oke dev
```

On a TTY, create-oke opens a Clack wizard to confirm the name and optionally
install dependencies and start `oke dev`. Pass `--yes` for non-interactive use.

| Port    | What                |
| ------- | ------------------- |
| `:6530` | your app            |
| `:6533` | Console             |
| `:6535` | MCP (live Manifest) |

The single bundled template is **standard**: the full recommended file layout
with empty scaffolding.

```bash
bunx create-oke@latest my-app --template standard
bunx create-oke@latest my-app --sql postgres
bunx create-oke@latest my-app --yes
```

`--sql sqlite|postgres` is opt-in. The default keeps the dual-mode Store
config (`local: sqlite` · `docker`/`prod: postgres`) and abstract
`src/schema.decl.ts` (dialect emitted from the active driver). Pass
`--sql postgres` to pin `oke.config.ts` `store.sql` local/docker/prod to
`postgres`. The interactive wizard does not ask and keeps the same dual-mode
default.

Store-bearing scaffolds ship `drizzle.config.ts` and `.env.example`. Local
`oke dev` auto-runs `oke db push` on schema change; use `oke mode docker` /
`oke dev --docker` for compose infra.

Every scaffold writes an `AGENTS.md` so coding agents know the OKE contract
(`--no-agents-md` to skip).

## Registries

| Registry  | Package                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------- |
| npm (CLI) | [`create-oke`](https://www.npmjs.com/package/create-oke) — use this with `bunx`                         |
| JSR       | [`@omqkhafi/create-oke`](https://jsr.io/@omqkhafi/create-oke) — same sources; prefer npm for the binary |

Requires **Bun ≥ 1.3**. Docs: [oke.omqkhafi.dev](https://oke.omqkhafi.dev) · [handbook](https://oke.omqkhafi.dev/docs).
