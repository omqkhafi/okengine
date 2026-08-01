---
name: oke-docs
description: Authors and rewrites OKE documentation pages under site/content/docs to the project's information-architecture standard — source-verified API claims, the progressive-disclosure page skeleton (plain intro, one rule, Quick start Steps, reference tables, Troubleshooting Accordions, Next cards), and the site's hard gates (prose density ≤3, fumadocs components, forbidden tokens). Use when creating a new docs page, editing or improving any page under site/content/docs (elements, console, get-started), or when the user asks to raise documentation quality. For the prompt "/oke-docs update site docs" after an implementation, use the oke-docs-update skill (it inventories stale pages then applies this standard).
---

# OKE Docs — information architecture standard

Rewrite or author docs pages the way the eight element pages were rewritten (canonical examples: `site/content/docs/elements/vault.mdx`, `flow.mdx`, `store.mdx`). The goal: a page an ordinary user can learn from, where every claim is true in the source code.

**After a code change**, when the user says `/oke-docs update site docs`, load [oke-docs-update](../oke-docs-update/SKILL.md) first — it picks which pages to sync, then this skill’s rules apply to each page.

## The workflow

Follow this order — never skip step 2.

1. **Read the current page fully.** Salvage what is accurate (consequence examples, good analogies); list what is wrong, missing, or internal-facing.
2. **Verify the API surface from source.** Docs claims come from code, never from memory or from the old page. Sources of truth:
   - Element declarations: `src/elements/<name>.ts` + `src/elements/<name>/declare.ts`
   - Runtime handles (what flows actually call): `src/elements/<name>/runtime.ts`, `src/kernel/fx.ts`
   - Driver id unions: `src/drivers/*-types.ts` (e.g. `ChannelDriverId`, `AiDriverId`)
   - Real default configs: `packages/create-oke/template/oke.config.ts`
   - Error codes users see: grep the error class name
   - Cross-link targets must exist: check `site/content/docs/console/*.mdx` before linking
   - **Correct the old page when it lies** (precedents: it listed `kafka` as a signal driver that doesn't exist; it used `Date.now()` inside flows, violating the fx rule).
3. **Write with the skeleton** — copy [skeleton.md](skeleton.md) and fill it.
4. **Run the gates** (below) and fix every failure.
5. **Close with a before/after summary** — what was wrong, what changed, what was verified against which file.

## Page architecture (fixed order)

1. **Frontmatter** — `title`, `description` (one plain sentence: what it is + when you touch it), `icon`, `source: "docs/spec/unified-theory.md"`.
2. **Intro paragraph** — 2–3 lines, ordinary words: what this is for, named concretely ("the order-confirmation email", not "human reach"). No theory.
3. **"The one rule" Callout** — the single user-facing law of the element, phrased as what the _user_ must do, not as an internal detail.
4. **Quick start** — `<Steps>` that complete a _full loop_ (declare → use → see the result). Working code with real imports, real option names, real defaults.
5. **Reference tables** — options/declarations with types, defaults, meanings; per-environment drivers using the template config as truth.
6. **Element-specific deep sections** — the physics that make this element distinct (delivery semantics, durability, consent, PII egress…), each with a verified example.
7. **Troubleshooting** — `<Accordions>` of _real_ failure modes: the error a user actually hits, why it happens, the fix. Not invented FAQs.
8. **Learn more** — bulleted cross-links (only to pages that exist).
9. **Next** — `<Cards>`: next element, Introduction, Console.

## Writing rules

- **Every API claim verified** against the files above — option names, defaults, unions, error text. Quote real error messages verbatim.
- **Code examples must be real**: correct imports from `okengine`, real method chains, no invented helpers. If it wouldn't typecheck conceptually, it doesn't ship.
- **No internal references**: no `src/…` paths, no test file names, no internal ticket/plan ids, no "Prompt 42". User-facing error codes (`OKE1101`) are fine.
- **No jargon without definition**: explain in the user's vocabulary first; the theory word comes after, if at all.
- **Tables over prose** for enumerations; **examples over adjectives** for behavior.
- **Duplicated headings are a defect** — if two `###` say the same thing, merge them.
- **Consequences, not just syntax**: for non-obvious choices, state what follows ("**Consequence:** keyset pages stay stable under inserts").
- Docs are written in **English**, plain and direct.

## Hard gates (all must pass)

Run from `site/`:

```bash
bun test lib        # prose-density gate + link/diagram gates — must be 0 fail
bunx fumadocs-mdx   # MDX must compile
```

| Gate             | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prose density    | **≤3 consecutive plain paragraph lines** — blank lines reset, but _Callout and Accordion bodies count too_. Compress; never pad.                                                                                                                                                                                                                                                                                                    |
| Components       | Fumadocs: `Cards`/`Card`, `Callout`, `Steps`/`Step`, `Accordions`/`Accordion`, `Tabs`/`Tab`, `TypeTable`. Docs visuals: `Features`, `CollapseDiagram`, `ManifestPipeline`, `Surfaces`, `Vocabulary`, `FlowShape`, `DevModes`, `ClientLoop`, `DriftBoard`, `CollapseBoard`. Element visuals: `FlowTriggers`, `SignalDelivery`, `StoreFacets`, `ClockSchedules`, `GatePipeline`, `VaultResolution`, `ChannelPhysics`, `AiGuardrails`. |
| Forbidden tokens | `"--"+"stack"`, `".env."+"stack"`, `"OKE_"+"STACK"`, `"from"+"Stack"`, `"so"+"ps"` — never appear. Named peers (`"Ho"+"no"`, `"Ely"+"sia"`, `"Enc"+"ore"`, `"Nest"+"JS"`, `"Fast"+"ify"`, `"iii"+".dev"`, `"Ex"+"press"`) — never appear (see `src/cli/competitor-mention-removal.test.ts`).                                                                                                                                        |
| Ports            | App `6530`, Console `6533` — no other numbers.                                                                                                                                                                                                                                                                                                                                                                                      |

To locate a density violation precisely, run this scanner (it mirrors the gate):

````bash
bun -e '
const raw = await Bun.file("content/docs/<page>.mdx").text();
const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
const STRUCTURAL = /^(<(Cards|Card|Callout|Tabs|Tab|TypeTable|Features|CollapseDiagram|ManifestPipeline|Surfaces|Vocabulary|FlowShape|DevModes|ClientLoop|FlowTriggers|SignalDelivery|StoreFacets|ClockSchedules|GatePipeline|VaultResolution|ChannelPhysics|AiGuardrails|Steps|Step|Accordions?)\b|```|#{1,6} |\||\w+="|[/]?>$)/;
function isPlain(l){const t=l.trim();if(!t)return false;if(STRUCTURAL.test(t))return false;if(/^[-*+] /.test(t)||/^\d+\. /.test(t))return false;if(t.startsWith(">")||t.startsWith("</"))return false;if(t==="---")return false;return true;}
let run=0,inFence=false;
body.split("\n").forEach((l,i)=>{
  if(l.trimStart().startsWith("```")){inFence=!inFence;run=0;return;}
  if(inFence){run=0;return;}
  if(isPlain(l)){run++;if(run>3)console.log(`run=${run} @ line ${i+1}: ${l.trim().slice(0,90)}`);}else run=0;
});'
````

## Authority

`AGENTS.md` is the contract: eight elements, ten exports, drivers named after protocols, the fx rule. If the documentation would claim something the source does not support, **stop and ask** — do not invent the API.

## Reference

- Copy-paste starting point: [skeleton.md](skeleton.md)
- Canonical finished pages to match in tone: `site/content/docs/elements/vault.mdx`, `flow.mdx`
