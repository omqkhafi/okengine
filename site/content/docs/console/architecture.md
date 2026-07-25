---
title: "Architecture"
description: "How it all connects — the diagram that is the code."
source: "docs/spec/console.md"
---

#### 9.13 Architecture

The second rendering of the same graph the Flows panel shows as columns, so the division must be sharp: **Flows answers "which one"; Architecture answers "what shape".** Columns give precision, sorting and filtering; the graph gives spatial memory, topology and distance — things a list can never convey.

**It never shows the whole system by default.** Every architecture tool collapses at scale; a diagram with sixty services is spaghetti nobody reads. The default is clustered by unit with aggregated edges, then focus on a node at a depth of one or two hops.

**Element layers are the feature nobody else can build.** Our edges are typed, so they toggle: data (Store), messaging (Signal), time (Clock), external (Channel/AI). A diagram showing everything is noise; a diagram showing only messaging is a clear picture.

**We draw the boundary of your system.** Because the irreversible tier is known, the line that arrows cross to leave can be drawn — so for the first time you *see* where your system touches the outside world. The count of boundary crossings becomes a security and architecture metric in its own right: watching it climb from 2 to 9 over six months is a silent degradation nobody tracks today.

**The diagram is alive.** Edge thickness is real traffic, not declaration — hand-drawn diagrams give every arrow the same weight and so hide where the system actually lives. A **dashed edge is declared in code and never traversed**: dead code at the architecture level. Tools detect uncalled functions; nobody detects a declared *relationship* between two units that has never been used — and that is more dangerous, because it keeps a coupling alive in the team's mental model that does not exist in reality.

**Pathologies are computed from the graph as data**: cycles, god nodes, orphan signals, single points of failure. The diagram becomes a diagnostic instead of a picture. Exports are always accurate, because the diagram *is* the code — architecture documentation that cannot go stale.
