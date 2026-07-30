# Page skeleton — copy and fill

Replace every `⟨…⟩`. Delete sections that genuinely don't apply rather than leaving filler. Keep the order.

````mdx
---
title: "⟨Element⟩"
description: "⟨One plain sentence: what it is and when the user touches it.⟩"
icon: "⟨IconName⟩"
source: "docs/spec/unified-theory.md"
---

⟨2–3 lines. What this is for, in ordinary words, with a concrete example —
"the order-confirmation email", not "human reach". No theory, no internals.⟩

<Callout title="The one rule">
  ⟨The single user-facing law, phrased as what the user must do — max 3 lines.⟩
</Callout>

## Quick start

<Steps>

<Step>
### ⟨Declare / configure it⟩

⟨Working code: real imports, real option names, real defaults.⟩

</Step>

<Step>
### ⟨Use it⟩

⟨The call a flow/user actually makes.⟩

</Step>

<Step>
### ⟨See the result⟩

⟨What the user observes: a response, a row, a UI, a command.⟩

</Step>

</Steps>

## ⟨Reference — declarations / options⟩

| Declaration / option | Type | Default | Meaning |
| -------------------- | ---- | ------- | ------- |
| ⟨verified name⟩      | ⟨t⟩  | ⟨d⟩     | ⟨what⟩  |

## ⟨The distinct physics of this element⟩

⟨One section per irreducible behavior — each with a verified example.
Consequences stated: "**Consequence:** …" for non-obvious choices.⟩

## Per-environment drivers

```typescript title="oke.config.ts"
⟨the real block from packages/create-oke/template/oke.config.ts⟩
```
````

| Driver | Runs as | Best for |
| ------ | ------- | -------- |
| ⟨id⟩   | ⟨…⟩     | ⟨…⟩      |

## Troubleshooting

<Accordions>
<Accordion title="⟨The error/symptom a user actually hits⟩">

⟨Why it happens. The fix. Real error text verbatim where one exists.⟩

</Accordion>
</Accordions>

## Learn more

- [⟨Related element⟩](/docs/elements/⟨x⟩) — ⟨why follow the link⟩
- [Console · ⟨Panel⟩](/docs/console/⟨x⟩) — ⟨what it shows⟩

## Next

<Cards>
  <Card title="⟨Next element⟩" description="Continue to ⟨Next element⟩." href="/docs/elements/⟨x⟩" />
  <Card
    title="Introduction"
    description="Eight elements overview."
    href="/docs/get-started/introduction"
  />
  <Card
    title="Console"
    description="Panels derived from the Manifest."
    href="/docs/console/overview"
  />
</Cards>
```

## Pre-flight checklist

- [ ] Every option/default/union/error verified against source (not copied from the old page)
- [ ] No `src/` paths, test names, or internal ids anywhere
- [ ] `bun test lib` → 0 fail (prose density ≤3, incl. inside Callout/Accordion bodies)
- [ ] `bunx fumadocs-mdx` → compiles
- [ ] No forbidden tokens (`"--"+"stack"`, `".env."+"stack"`, `"OKE_"+"STACK"`, `"from"+"Stack"`, `"so"+"ps"`)
- [ ] Cross-links point to pages that exist
