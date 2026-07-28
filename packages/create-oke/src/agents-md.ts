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

## How to use OKE

**Mental model:** every backend behavior is a Flow. All world access goes
through \`fx\`. New infrastructure is a **driver** on an existing element —
never a ninth element.

### Canonical Flow

Same species for HTTP, cron, and signal consumers — only the trigger changes:

\`\`\`typescript
import { on, flow, http, every } from "okengine";

export const create = on(
  http.post("/pings").gate(fair),
  flow({
    name: "main.create",
    in: NewPing,
    out: PingId,
    do: async (input, fx) => {
      const [row] = await fx.store(db).insert(pings).values(input).returning();
      await fx.emit(pinged, { id: row.id, note: row.note, at: Date.now() });
      return { id: row.id };
    },
  }),
);

on(pinged, flow({
  name: "main.onPinged",
  do: async ({ id, note }, fx) => {
    await fx.send(pingNotice, { to: "dev@localhost", data: { id, note } });
  },
}));

on(every("1h"), flow({
  name: "main.prune",
  do: (_input, fx) => fx.store(db).delete(pings).where(/* … */),
}));
\`\`\`

- **Trigger** — \`http.*\`, \`every(...)\`, or a signal — always \`on(Trigger, flow)\`
- **Contracts** — \`in\` / \`out\` / \`errors\` (Standard Schema)
- **Body** — \`do(input, fx)\` only. No raw \`fetch\`, \`node:fs\`, or vendor SDKs

### \`fx\` surface

| Call | Element |
|---|---|
| \`fx.store(db)\` | Store |
| \`fx.emit(signal, payload)\` | Signal |
| \`fx.vault(secret)\` | Vault |
| \`fx.send(template, opts)\` | Channel |
| \`fx.ask(prompt, input)\` | AI |
| \`fx.call(flow, input)\` | Flow (untriggered / named) |
| \`fx.fail("ErrorName", data)\` | typed error result |
| \`fx.clock.now()\` / \`fx.clock.sleep(label, duration)\` | Clock |

Effects are inferred from what the Flow touches through \`fx\`.

### App wiring

\`\`\`typescript
import { oke } from "okengine";
import * as main from "./flows/main";

export const app = oke({ name: "${projectName}" }).adopt({ main });

Object.assign(app.$options, {
  gates: [fair],
  secrets: [appSecret],
  signals: [pinged],
  stores: [db],
  channel: { templates: [pingNotice], defaultLocale: "en" },
});
\`\`\`

### App file layout

\`\`\`text
oke.config.ts          # drivers + images
src/app.ts             # oke().adopt + register elements
src/schema.ts          # tables
src/core.ts            # store handle (db)
src/flows/<unit>/
  index.ts             # on(…) + flow({…})
  shapes.ts            # contracts
  signals.ts           # signal declarations
src/gates.ts · vault.ts · channels.ts
\`\`\`

### Config rule

- \`drivers\` — protocols by mode (\`postgres\`, \`redis\`, \`s3\`, \`smtp\`, …)
- \`images\` — vendor choice for Docker (\`postgres:18-alpine\`, …)
- Never name a driver after a vendor (\`neon\`, \`minio\`, …)

**Deploy:** \`prod\` protocols in \`oke.config.ts\`; connection values
(\`DATABASE_URL\`, \`REDIS_URL\`, vault secret names) from host \`process.env\`.
Staging = second deploy with different env values. See
${docsUrl("/docs/get-started/deploy")}. Generate with \`oke docker --prod\`;
entry is \`oke start\`.

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

## The ten exports

\`\`\`typescript
import { on, flow, signal, store, clock, gate, vault, channel, ai, plugin } from "okengine";
\`\`\`

That is the entire public vocabulary. Everything else is derived.

## The fx rule

**All world access goes through \`fx\`. No exceptions.**

A direct \`node:\` import (or any other side-channel I/O) in element or flow
code is a **defect**. \`fx\` is the single door to the outside world; effects
are inferred from what a Flow touches through it.

## Ports

| Port | Surface |
|---|---|
| **6530** | App |
| **6533** | Console |
| **6535** | MCP |

Mnemonic: O·K·E = 6·5·3.

## How to run

\`\`\`bash
bun install
oke dev          # or: bun run dev
# oke mode docker && oke dev   # postgres/redis like prod (laptop)
\`\`\`

App \`:6530\` · Console \`:6533\` · MCP \`:6535\`.

Deploy: \`oke docker --prod\` then host the \`docker/\` artefacts; set env on the
platform (see ${docsUrl("/docs/get-started/deploy")}).

## Do / Don't

| Don't | Do |
|---|---|
| I/O outside \`fx\` (\`fetch\`, \`node:fs\`, vendor SDKs in flow bodies) | \`fx.store\` / \`fx.emit\` / \`fx.send\` / \`fx.vault\` / \`fx.ask\` |
| Invent endpoints, jobs, or handlers beside Flows | \`on(trigger, flow({…}))\` |
| Add a ninth “element” | New **driver** on an existing element |
| Driver id = vendor (\`neon\`, \`minio\`) | Protocol id + vendor in \`images\` |
| Guess behavior the docs do not define | Stop and ask |

## Learn more

- Handbook: ${handbook}
- Get started: ${docsUrl("/docs/get-started/introduction")}
- Deploy: ${docsUrl("/docs/get-started/deploy")}
- AI resources: ${docsUrl("/docs/ai/resources")}
`;
}
