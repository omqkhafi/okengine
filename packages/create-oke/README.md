# create-oke

Scaffold an [okengine](https://www.npmjs.com/package/okengine) app.

```bash
bunx create-oke@latest my-app --template hello
cd my-app
oke dev
```

| Port | What |
|---|---|
| `:6530` | your app |
| `:6533` | Console |
| `:6535` | MCP |

Default template is **standard** (full recommended file layout, empty scaffolding).
Pick another with `--template`, or start from a teaching example with `--from-example`:

```bash
bunx create-oke@latest my-app --template hello
bunx create-oke@latest my-app --template minimal
bunx create-oke@latest my-app --template full
bunx create-oke@latest my-notes --from-example notes
```

| Template | Purpose |
|---|---|
| `hello` | Fastest possible "it works" — one flow, no Store |
| `minimal` | Smallest shape you'd actually ship — Store + 1–2 flows |
| `standard` | Full recommended file layout, empty scaffolding (default) |
| `full` | Every element present and wired, no business logic |

`--from-example` copies a teaching example (including its business logic and
comments) — most new projects want `--template` instead.

| Example | Adds |
|---|---|
| `notes` | `oke` · `flow` · `http` · `store.sql` · typed client |
| `linkly` | `signal` · `clock` · `gate` |
| `provisions` | durable flows · `vault` · `channel` · plugins |
| `skyport` | `ai` · multi-tenancy · distributed topology |

With no arguments in a real terminal, create-oke asks for a project name and
template interactively. Non-TTY / CI / any explicit flag stays fully scriptable
— zero prompts.

## Registries

| Registry | Package |
|---|---|
| npm (CLI) | [`create-oke`](https://www.npmjs.com/package/create-oke) — use this with `bunx` |
| JSR | [`@omqkhafi/create-oke`](https://jsr.io/@omqkhafi/create-oke) — same sources; prefer npm for the binary |

Requires **Bun ≥ 1.3**. Framework docs: [okengine README](https://github.com/omqkhafi/okengine#readme) · [unified theory](https://github.com/omqkhafi/okengine/blob/main/docs/spec/unified-theory.md).
