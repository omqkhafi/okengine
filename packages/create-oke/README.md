# create-oke

Scaffold an [okengine](https://www.npmjs.com/package/okengine) app.

```bash
bunx create-oke@latest my-app
cd my-app
oke dev
```

| Port | What |
|---|---|
| `:6530` | your app |
| `:6533` | Console |
| `:6535` | MCP |

Default template is **Notes** (same tree as [`examples/notes`](https://github.com/omqkhafi/okengine/tree/main/examples/notes)). Pick another with `--template`:

```bash
bunx create-oke@latest my-links --template linkly
bunx create-oke@latest my-shop --template provisions
bunx create-oke@latest my-sky --template skyport
```

| Template | Adds |
|---|---|
| `notes` | `oke` · `flow` · `http` · `store.sql` · typed client |
| `linkly` | `signal` · `clock` · `gate` |
| `provisions` | durable flows · `vault` · `channel` · plugins |
| `skyport` | `ai` · multi-tenancy · distributed topology |

## Registries

| Registry | Package |
|---|---|
| npm (CLI) | [`create-oke`](https://www.npmjs.com/package/create-oke) — use this with `bunx` |
| JSR | [`@omqkhafi/create-oke`](https://jsr.io/@omqkhafi/create-oke) — same sources; prefer npm for the binary |

Requires **Bun ≥ 1.3**. Framework docs: [okengine README](https://github.com/omqkhafi/okengine#readme) · [unified theory](https://github.com/omqkhafi/okengine/blob/main/docs/spec/unified-theory.md).
