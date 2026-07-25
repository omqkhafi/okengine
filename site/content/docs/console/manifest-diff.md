---
title: "Manifest Diff"
description: "Blast radius of a deploy: new effects, widened permissions."
source: "docs/spec/console.md"
---

#### 9.12 Manifest Diff

The panel with no counterpart in any tool, because **it compares meaning rather than lines**. `git diff` says a line changed; this says the system's *behaviour* changed — and they are not the same thing. One edited line can widen a permission; a hundred reordered lines can change nothing.

Changes are sorted by **blast radius**, and the ordering is derived rather than chosen:

| Category | Test | Example |
|---|---|---|
| **Contract breaking** | an existing client will fail | required field added · type changed · error removed |
| **Permission widening** | the attack surface grew | gate removed · scope widened · flow became public |
| **Effect widening** | the system now does more | new write · new external effect · new secret read |
| **No impact** | shape unchanged | internal renames, comments, reordering |

**The two middle categories are the ones nobody else can produce**, because they require effects and gates to exist as declared data rather than as prose.

**The most valuable line the panel can print** multiplies a change by its real traffic: *"this flow ran 41,208 times last week, it sent nothing, and it will now email every caller."* A two-line code change with an irreversible effect on forty thousand people. `git diff` shows the added `fx.send`; it can never tell you how often that path is taken.

Cost is translated into a **weekly bill, not a per-call delta** — `+$0.018` stops nobody, `+$212 per week` stops everybody. Same data, and the unit is what creates the decision.

**The CI gate blocks the *undeclared* break, not the break.** Breaking is allowed if you write `breaking: true` and mean it; permission and effect widening need an approver. The difference between an intended break and an accidental one is the whole point, and it is consistent with the stability contract (codemods with every breaking change, three-year LTS).
