---
title: "AI Resources"
description: "AGENTS.md, MCP :6535, and machine-readable docs surfaces."
source: "docs/spec/unified-theory.md"
---

### 25. The AI contract

`AGENTS.md` + MCP (`:6535`) expose the Manifest, schemas, effects, traces, and the Console's safe runtime actions. Because capabilities are least-privilege and structural edits arrive as reviewable diffs, an agent can operate the system **without the ability to exceed what the code declares**.

OKE is the first backend an AI can fully read, safely operate, and provably not break.

**Two directions, one design.** §25 covers AI *for the developer* (agents operating your system through MCP). The AI element (§5) covers AI *inside the application* (models, prompts, agents your users trigger). Both rest on the same foundation — declared effects and least-privilege capabilities — which is why an agent in either direction is bounded by construction rather than by policy.

---

## Part VIII — Execution


## Agent contract (AGENTS.md)

## OKE — Agent Contract

This file is for coding agents. Read it before changing OKE apps or this
repo. Specs live in `docs/spec/`. **If the spec is silent, stop and ask.**


## Machine-readable docs

This documentation site also exposes Fumadocs AI surfaces (same pattern as modern TS library docs):

- [`/llms.txt`](/llms.txt) — index of documentation pages for agents
- [`/llms-full.txt`](/llms-full.txt) — full concatenated docs text
- `/llms.mdx/docs/...` — per-page markdown for a given docs slug

The runtime MCP surface remains on port **6535** (see the AI contract above).
