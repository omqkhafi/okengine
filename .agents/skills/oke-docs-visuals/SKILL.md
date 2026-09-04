---
name: oke-docs-visuals
description: >-
  Builds and upgrades OKE element-docs micro-interactions and teaching figures
  under site/components/docs — information-carrying ambient demos (FlowTriggers /
  SignalDelivery quality), not decorative hover chrome. Use when the user asks to
  bring a docs page to life, add or fix Store/Flow/Signal/element visuals, raise
  micro-interaction quality, visualize claims that tables under-teach, or when
  editing StoreFacets, StoreKvTtl, StoreFilesVariants, StoreIndexModes, StoreSeeding,
  FlowTriggers, FlowDurable, SignalDelivery, SignalOnceLease, SignalBroadcastFanout,
  SignalLiveReplay,
  ClockSchedules, ClockCatchUp, ClockSleep, GatePipeline, AiBlocks, AiGuardrails,
  AiPiiEgress, or sibling element figures. Companion to oke-docs (page IA) and
  landing-motion (marketing surfaces).
---

# OKE Docs Visuals — element teaching figures

Ambient demos that **prove** a claim. If removing the motion leaves the same understanding as a table, cut it or redesign it.

Canonical quality bar (read before inventing):

| Page   | Component                                                                                | What motion proves                                                                      |
| ------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Flow   | `FlowTriggers` + `FlowDurable`                                                           | Any trigger → one Flow species; kill→resume skips completed `fx.step`                   |
| Vault  | `VaultResolution` + `VaultRedacted`                                                      | First-hit chain + fail-loud; Redacted until `.reveal()`                                 |
| Signal | `SignalDelivery` + `SignalOnceLease` / `SignalBroadcastFanout` / `SignalLiveReplay`      | once / broadcast / live packet physics; lease reclaim; fan-out + offline miss; late `bus.live()` history |
| Store  | `StoreFacets` + `StoreKvTtl` / `StoreFilesVariants` / `StoreIndexModes` / `StoreSeeding` | Facet physics; TTL contrast; putImage fan-out; vector vs text; seed env→blocks + upsert |
| Clock  | `ClockSchedules` + `ClockCatchUp` / `ClockSleep`                                         | two triggers → one Flow; catch-up `"one"`; durable sleep survives restart               |
| Gate   | `GatePipeline`                                                                           | Left-to-right chain; first denial wins; typed Unauthorized / Forbidden / RateLimited    |
| AI     | `AiBlocks` + `AiGuardrails` / `AiPiiEgress`                                              | Four decls; versioned / PII / maxSteps / no prod default; third-party vs local openai-compatible egress  |

Shared primitives: [`site/components/docs/reveal.tsx`](../../../site/components/docs/reveal.tsx) (`RevealGroup`, `RevealItem`, `useTick`, `BeatPing`). Tone: `CHIP_TONE` + `--oke-el-*` from [`site/lib/element-tones.ts`](../../../site/lib/element-tones.ts).

Page IA, prose density, and API truth still come from [oke-docs](../oke-docs/SKILL.md). This skill owns **visuals only**.

## When to add a figure

Deduce claims that **tables or prose under-teach**. Prefer a demo when:

1. **Opposite physics, same API** — e.g. KV `set(…, "30m")` under `redis` vs `memory`.
2. **Fan-out / lifecycle** — e.g. `putImage` → original + `{stem}.{variant}.{ext}` + LQIP result.
3. **Discriminated models** — e.g. `store.index` vector vs meilisearch (different `upsert`/`search`/`score`).
4. **Fan-in to one species** — e.g. five triggers → one Flow.

Do **not** add hover-only verb chips or scroll-settle strips that only decorate section headings. `StoreFacetMark` is a compact teaching strip with the same ambient demo as the overview — not chrome.

## Workflow

```
Task:
- [ ] 1. Name the claim the motion must prove (one sentence)
- [ ] 2. Verify the claim in source (declare/runtime/drivers) — no invented physics
- [ ] 3. Pick pattern: contrast cards · tick cycle · SVG packet / fan-out
- [ ] 4. Implement under site/components/docs/elements/ (or docs/)
- [ ] 5. Wire MDX + density STRUCTURAL + oke-docs component list
- [ ] 6. Place under the heading that teaches that claim
- [ ] 7. Gates: bun test lib + bunx fumadocs-mdx from site/
```

### 1–2. Claim + source

Write the aria-label as the claim. Every phase label, driver id, key shape, and score meaning must match code. Prefer real option strings (`"30m"`, `photos/x.thumb.webp`).

### 3. Patterns (use these)

| Pattern                  | When                         | How                                                                                                                       |
| ------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Contrast cards**       | Same call, different drivers | Two `RevealItem` cards, shared `useTick` beat, opposite end states (`StoreKvTtl`)                                         |
| **Tick cycle**           | Ordered ops / phases         | `useTick(ms)` → `phase % N`; `BeatPing` on the active chip; light sinks by phase (`StoreFacets` SQL/KV demos)             |
| **SVG packet / fan-out** | Path or one→many             | Animate `cx`/`opacity` only (not SVG `width`); spring settle between discrete positions (`SignalDelivery`, Files put→get) |
| **Mode spotlight**       | Discriminated union          | Cards take turns `tone.lit` + distinct mini-demo per mode (`StoreIndexModes`, `FlowTriggers`)                             |

House motion rules:

- `MotionConfig reducedMotion="never"` when using framer transforms; gate with `useClientReducedMotion`.
- Reduced motion → `tick === null` / static end state — never a half-animated loop.
- Springs: stiffness ~380, damping ~32 (reveal); icon wiggle ~520/28 when used.
- Ink: `var(--oke-el-<element>)` for packets; `CHIP_TONE.<element tone>` for chips (Store = teal).
- Deterministic — **never `Math.random()`**.

### 4. RevealItem / RevealGroup constraints

`RevealItem` `as` allows **only** `div` | `li` | `ul` | `ol`.  
`RevealGroup` `as` allows **only** `div` | `ul` | `ol`.

`as="p"` (or anything else) → `Tag` is `undefined` → runtime crash. Use `as="div"` for captions.

### 5. Wire every new component

1. Export from `site/components/docs/elements/<file>.tsx` (`"use client"`).
2. Register in [`site/components/mdx.tsx`](../../../site/components/mdx.tsx) `getMDXComponents`.
3. Add the tag name to the prose-density `STRUCTURAL` regex in:
   - [`site/lib/prose-density.gate.test.ts`](../../../site/lib/prose-density.gate.test.ts)
   - [oke-docs SKILL.md](../oke-docs/SKILL.md) scanner + Components table
4. Use in MDX: `<StoreKvTtl />` / `<FlowDurable />` under the matching heading.
5. Changelog under `## Unreleased` → `### ♻️ Changed` → `#### Docs` (via oke-ship when closing work).

### 6. Placement

- Overview figure near intro / after the one-rule Callout (`<StoreFacets />`, `<SignalDelivery />`).
- Physics figure **immediately under the heading that states the claim** (TTL, Images, Index modes) — before long fences when the demo teaches the shape.
- Per-section marks (`StoreFacetMark`) only if they carry the same ambient demo as the overview card for that facet — not hover-only.

### 7. Gates

```bash
cd site && bun test lib && bunx fumadocs-mdx
```

Fix density (≤3 plain lines) and MDX compile. Format with `bunx oxfmt` on touched TSX.

## Multi-facet element pages (Store pattern)

When an element has independent facets (sql · kv · files · index):

1. **Reorganize around physics**, not chronology — each major `##` facet self-contained (Quick start → handle API → drivers → examples).
2. **Equal depth** — if SQL has Steps + tables + examples + drivers, KV/Files/Index get the same shape; no thin leftover sections.
3. **Overview grid** proves “four facets, one handle”; **section physics demos** prove claims unique to that facet.
4. **Advanced** sections only for real cross-facet / cross-element composition (no invented sync APIs).
5. Preserve every verified fence when restructuring — relocate, don’t delete.

## Anti-patterns

| Don’t                                                                 | Do                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------ |
| Hover-only verb chips as the whole demo                               | Ambient `useTick` / packet loop that teaches                 |
| Animate SVG `width` keyframes                                         | Discrete phase opacity / `cx` springs (width anim is flaky)  |
| Invent visual “APIs” not in runtime                                   | Quote real methods, drivers, key shapes                      |
| `RevealItem as="p"`                                                   | `as="div"`                                                   |
| Duplicate a table and a demo that say the same thing without contrast | Demo for the non-obvious claim; keep a thin consequence line |
| Landing-page purple glow / random sparkle                             | Monochrome + element tone; information first                 |

## Checklist

```
- [ ] One-sentence claim in aria-label
- [ ] Claim verified in declare/runtime/drivers
- [ ] Pattern matches FlowTriggers / SignalDelivery quality
- [ ] Reduced motion → static end state
- [ ] RevealItem/Group `as` only allowed tags
- [ ] Registered in mdx.tsx + STRUCTURAL (gate + oke-docs)
- [ ] Placed under the teaching heading
- [ ] bun test lib + fumadocs-mdx green
```

## Reference

- Primitives: `site/components/docs/reveal.tsx`
- Store overview + marks: `site/components/docs/elements/store-facets.tsx`
- Store physics: `site/components/docs/elements/store-physics.tsx`
- Store seeding: `site/components/docs/elements/store-seeding.tsx` (`StoreSeeding`)
- Flow bars: `flow-triggers.tsx`, `flow-durable.tsx`
- Signal bars: `signal-delivery.tsx`, `signal-physics.tsx` (`SignalOnceLease`, `SignalBroadcastFanout`, `SignalLiveReplay`)
- Clock bars: `clock-schedules.tsx`, `clock-physics.tsx` (`ClockCatchUp`, `ClockSleep`)
- Gate bars: `gate-pipeline.tsx`
- AI bars: `ai-blocks.tsx`, `ai-guardrails.tsx`, `ai-physics.tsx` (`AiPiiEgress`)
- Page IA: [oke-docs](../oke-docs/SKILL.md)
- Marketing (not element docs): personal `landing-motion` skill
