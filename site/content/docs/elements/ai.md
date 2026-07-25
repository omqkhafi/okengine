---
title: "AI"
description: "reaching machine intelligence — Models, prompts, agents, and RAG earn an element slot: non-determinism, cost, versioned prompts, egress privacy, and different test physics."
source: "docs/spec/unified-theory.md"
---

AI is the element for **reaching machine intelligence**.

Models, prompts, agents, and RAG earn an element slot: non-determinism, cost, versioned prompts, egress privacy, and different test physics.

An element earns its place only if it has **irreducible physics**. New infrastructure becomes a new **driver** for an existing element — never a ninth element.

## At a glance

| Element | Replaces the zoo of | Essence |
|---|---|---|
| **AI** | model calls · prompts · embeddings · agents · RAG | reaching machine intelligence |

## Why this is an element

#### Why AI is an element and not a library

Apply the same test — does it have physics no existing element expresses?

| What an AI-powered backend needs | Covered by an existing element? |
|---|---|
| streaming tokens to the client | ✅ `Signal` with `delivery: "live"` |
| an agent loop with steps | ✅ `Flow` with `durable: true` |
| vector search for RAG | ✅ `Store` facet `index` |
| provider fallback chains | ✅ same pattern as `Channel` |
| **non-determinism** (same input ≠ same output) | ❌ breaks caching, testing, and replay |
| **cost as a first-class dimension** | ❌ no element has a concept of price per call |
| **prompts as versioned, evaluated artifacts** | ❌ neither a template nor a schema |
| **egress privacy boundaries** to third parties | ❌ Gates guard entry, not exit |
| **testing a non-deterministic output** | ❌ entirely different test physics |

Five properties are irreducible, so AI earns the eighth slot.

**On the tension with our own rule.** "New technology is a driver, not a concept" still holds — Anthropic → Bedrock → a 2030 provider are all drivers. But probabilistic inference is not new *infrastructure*; it is a new *category of interaction*. The symmetry is exact: **Channel reaches humans, AI reaches machine intelligence.** Neither can be expressed by Store or Signal.

## Example from the teaching apps

Claimed fence from **skyport** — same source the doc-drift gate checks:

### `examples/skyport/src/ai.ts`

```typescript
import { ai, store } from "okengine";
import { z } from "zod";
import { getBooking, refundBooking } from "./flows/bookings";

export const smart = ai.model("smart", { provider: "anthropic", tier: "opus" });
export const fast  = ai.model("fast",  { provider: "anthropic", tier: "haiku" });

// A prompt is a VERSIONED ARTIFACT with a validated output shape — not a string in a handler
export const triage = smart.prompt("ticket-triage", {
  in:  z.object({ subject: z.string(), body: z.string() }),
  out: z.object({ urgency: z.enum(["low", "high"]), team: z.string(), summary: z.string() }),
  version: 3,
  evals: "./evals/triage.jsonl",          // regression-gated in CI via `oke eval`
  budget: { maxCostPerCall: 0.02 },       // cost is a first-class dimension
});

export const embed = ai.embed("docs", { model: fast, into: store.index("kb") });

// An agent whose tools are YOUR OWN FLOWS — each carrying its gates and effects
export const support = ai.agent("support", {
  model: smart,
  tools: [getBooking, refundBooking],
  maxSteps: 6,
  budget: { maxCostPerRun: 0.25 },
});
```

## Next

- [Learn · Notes](/docs/learn/notes)
- [Introduction](/docs/get-started/introduction) — eight elements overview
- [Console](/docs/console/overview) — panels derived from the Manifest
