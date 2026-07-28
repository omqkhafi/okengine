# vscode-okengine

Minimal VS Code extension: **effects CodeLens** above each `flow(...)`
declaration, powered by the real oxc Manifest extractor (`extractManifest` /
`lensesForFile`). Read-only MVP — no Manifest Diff warnings.

## Debounce

| Trigger | Delay |
|---|---|
| Open / command refresh | immediate |
| Save | **300ms** (`EXTRACT_DEBOUNCE_MS`) |

Investigation: synthetic 200-flow extract is &lt; 2s in CI; notes/skyport-sized
projects are typically tens of milliseconds. 300ms coalesces rapid saves
without inventing a larger delay. Keystroke-level extraction is intentionally
out of scope for this MVP.

## Develop

```bash
# from repo root
bun install
bun run --cwd packages/vscode-okengine test
bun run --cwd packages/vscode-okengine evidence   # writes evidence/notes-codelens.md
bun run --cwd packages/vscode-okengine build
```

Then in VS Code: **Run → Start Debugging** with this folder open (or
`F5` on a launch config that opens `examples/notes`), and open
`examples/notes/src/flows/notes/index.ts`. CodeLens titles should match the
evidence file (e.g. `effects → writes[sql:notes]` above `create`).

## Manual verification (part 4 gate)

1. `bun run --cwd packages/vscode-okengine evidence` — machine-readable
   evidence in [`evidence/notes-codelens.md`](./evidence/notes-codelens.md).
2. Launch Extension Development Host → open notes flows file → confirm
   CodeLens matches that evidence (screenshot optional; the evidence file is
   the reproducible artifact).
