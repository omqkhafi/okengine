/**
 * Slim `AGENTS.md` written into every scaffolded app for coding agents.
 */

import { docsUrl } from "./docs-origin.ts";

/**
 * Render the app-facing agent contract for a new project.
 *
 * @param projectName - Sanitized package / folder name
 */
export function agentsMdContent(projectName: string): string {
  const handbook = docsUrl("/docs");
  return `# ${projectName} — OKE Agent Contract

This file is for coding agents (Cursor, Claude Code, Codex, …). Read it before
changing backend code. Handbook: ${handbook}

**If the docs are silent, stop and ask.**

## The one law

Every backend behavior is a Flow:

\`\`\`text
on(Trigger) → Effects
\`\`\`

There are no separate species called endpoints, handlers, consumers, jobs,
subscribers, or workflows. There is one species — the **Flow** — and triggers
are typed values.

## The eight elements

| Element | Essence |
|---|---|
| **Flow** | behavior |
| **Signal** | data in motion |
| **Store** | data at rest (\`sql\` · \`kv\` · \`files\` · \`index\`) |
| **Clock** | time |
| **Gate** | permission to act |
| **Vault** | protected knowledge |
| **Channel** | reaching humans |
| **AI** | reaching machine intelligence |

An element earns its place only if it has irreducible physics. New
infrastructure becomes a new **driver** for an existing element — never a
ninth element.

## Core programming vocabulary

\`\`\`typescript
import { on, flow, signal, store, clock, gate, vault, channel, ai, plugin } from "okengine";
\`\`\`

That is the core programming vocabulary. Everything else is derived.

## The fx rule

**All world access goes through \`fx\`. No exceptions.**

A direct \`node:\` import (or any other side-channel I/O) in element or flow
code is a **defect**. \`fx\` is the single door to the outside world; effects
are inferred from what a Flow touches through it.

## Ports

| Port | Surface |
|---|---|
| **6530** | Backend |
| **6533** | Console |
| **6535** | MCP |

Mnemonic: O·K·E = 6·5·3.

## How to run

\`\`\`bash
bun install
oke dev          # or: bun run dev
bun run web      # Vite SPA (proxies Flows to the app)
\`\`\`

App \`:6530\` · Console \`:6533\` · MCP \`:6535\`. Vite web is \`bun run web\`.

## Common mistakes

- ❌ I/O outside \`fx\` (raw \`fetch\`, \`node:fs\`, vendor SDKs in flow bodies)
- ✅ \`fx.store\` / \`fx.emit\` / \`fx.ask\` / channel sends through \`fx\`
- ❌ Inventing a ninth “element” or a parallel handler stack beside Flows
- ✅ New capability = new **driver** on an existing element, or a new Flow
- ❌ Untyped HTTP handlers that skip \`on\` / \`flow\` / contracts
- ✅ \`on(http.get(), flow({ in, out, do }))\` — or \`http.get("/…")\` / \`flow("unit.export", {…})\` when the folder is not the URL
- ❌ Returning \`{ items, count }\` from a list \`do\` (nests the pager inside \`data\`)
- ✅ \`out: z.array(Item)\` + \`fx.json.withQuery(rows, input)\` — or any other \`out\` you declare

## Learn more

- Handbook: ${handbook}
- Get started: ${docsUrl("/docs/get-started/introduction")}
`;
}
