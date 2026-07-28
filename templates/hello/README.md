# hello

Fastest possible “it works” — one unit, two HTTP flows, **no Store**.

## Run

```bash
bun install
oke dev          # app :6530 · Console :6533 · MCP :6535
# or: oke mode docker && oke dev   # compose infra on host Bun
```

| Port    | Try                    |
| ------- | ---------------------- |
| `:6530` | `GET /` · `GET /hello` |
| `:6533` | Console                |
| `:6535` | MCP                    |

## What’s in this template

```text
hello/
├── .env.example               # copied to .env.local by create-oke
├── oke.config.ts
├── src/
│   ├── app.ts                 # oke({ name: "hello" }).adopt({ hello })
│   └── flows/hello/index.ts   # GET / · GET /hello
└── tests/hello.test.ts
```

- **Elements:** Flow only (no `store`, `gate`, `vault`, `channel`, or `ai`)
- **Unit:** `hello`
- **Flows:** `root` (`GET /`), `hello` (`GET /hello` → `{ message: "ok" }`)

Replace `/hello` with your first real route. When you need persistence, move up to
`minimal` or `standard` — or keep growing this tree.

## Agent contract

See [`AGENTS.md`](./AGENTS.md). Handbook: [okengine.vercel.app/docs](https://okengine.vercel.app/docs)
