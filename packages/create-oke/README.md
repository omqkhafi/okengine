# create-oke

Scaffold an [okengine](https://www.npmjs.com/package/okengine) app.

```bash
bunx create-oke@latest my-app
cd my-app
oke dev
```

On a TTY, create-oke opens a Clack wizard:

1. Project name
2. **Starter** — `standard` (local-first Notes) or `advanced` (same domain,
   docker-ready + files/digest/AI hooks)
3. **Recommended defaults** · **Customize** (pick **local** or **docker** first,
   walk facets for that side, then optionally customize the other; saved to
   user-global `~/.oke/create-defaults.json`) · **Reuse previous settings**
   (only when saved settings exist for the selected template).
   The project-name step rejects a path that already exists and is not empty.
   Customize steps include **Back**. Scaffold writes `.oke/mode` from the
   primary side (recommended: standard → `local`, advanced → `docker`).
4. Install dependencies and start `oke dev`?

Pass `--yes` for non-interactive recommended defaults (zero prompts).

| Port    | What                |
| ------- | ------------------- |
| `:6530` | your app            |
| `:6533` | Console             |
| `:6535` | MCP (live Manifest) |

```bash
bunx create-oke@latest my-app --template standard
bunx create-oke@latest my-app --template advanced
bunx create-oke@latest my-app --sql postgres
bunx create-oke@latest my-app --yes
bunx create-oke@latest my-app --ai      # force AI model wizard before install
bunx create-oke@latest my-app --no-ai
```

`--sql sqlite|postgres` is opt-in. The default keeps the dual-mode Store
config (`local: sqlite` · `docker`/`prod: postgres`) and abstract
`src/db/schema.decl.ts` (dialect emitted from the active driver). Pass
`--sql postgres` to pin `oke.config.ts` `store.sql` local/docker/prod to
`postgres`. Customize can set drivers the template exposes; when AI is enabled,
model selection runs in the wizard **before** `bun install` (writes `.env.local`

- `src/core/ai.ts`).

Store-bearing scaffolds ship `drizzle.config.ts` and `.env.example`. Local
`oke dev` auto-runs `oke db push` on schema change and asks once whether to
seed; compose stack passwords are generated and preserved per project
(built-in vault needs no extra container). Both
templates include `.github/workflows/ci.yml` (typecheck + `bun test` on push/PR).

Every scaffold writes an `AGENTS.md` so coding agents know the OKE contract
(`--no-agents-md` to skip).

## Registries

| Registry  | Package                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------- |
| npm (CLI) | [`create-oke`](https://www.npmjs.com/package/create-oke) — use this with `bunx`                         |
| JSR       | [`@omqkhafi/create-oke`](https://jsr.io/@omqkhafi/create-oke) — same sources; prefer npm for the binary |

Requires **Bun ≥ 1.4.2**. Docs: [oke.omqkhafi.dev](https://oke.omqkhafi.dev) · [handbook](https://oke.omqkhafi.dev/docs).
