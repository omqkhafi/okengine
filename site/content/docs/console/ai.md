---
title: "AI"
description: "Prompt versions, eval scores, cost, agent runs."
source: "docs/spec/console.md"
---

#### 9.10 AI

**Everything else in the Console is deterministic; this is not.** A single trace tells you almost nothing about a flow that calls a model, so the panel is built on **distributions rather than single values**.

**A prompt version bump is a deploy.** Prompts are versioned artifacts with validated output shapes and eval sets that gate CI, so Manifest Diff treats a version change as real blast radius rather than a text edit.

**Schema-validation failure is its own class**, distinct from a provider error: the model answered, but the answer does not match the declared shape. Its rate per version is a quality metric, and it is the first thing to rise when a prompt is worded badly.

This is what makes promotion decisions automatic rather than intuitive: a version can score *higher* on evals and still be blocked because it returns invalid shapes 8.6% of the time and exceeds its per-call budget. Eval score alone would have shipped it.

**Agents are the strongest differentiator: their tools are the application's own flows.** Every tool call therefore carries its gates, its effects, and its cost — and when the model reaches beyond what was declared, the attempt is **denied, recorded and displayed**. No agent framework today can show an effect trail, because their tools are arbitrary functions. Containment here is demonstrated, not promised: a denial line is not an error, it is the system working.

Also here: model fallback chains with their cost consequence, semantic cache hit rate where enabled, and the `allowPii` list as a standing security-review surface.
