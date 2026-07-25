---
title: "Plugins"
description: "Installed plugins and their contributed panels."
source: "docs/spec/console.md"
---

#### 9.15 Plugins

**The composition method is `.plug()`**, and **scope is determined by the attachment point**: `app.plug()` is app-wide, `unit.plug()` covers one unit, `flow.plug()` covers one flow. Fastify's encapsulation DAG is the most successful plugin model in Node — registration creates a scope, changes reach descendants but not ancestors, and breaking out requires an explicit wrapper — but it is also its most misunderstood feature, precisely because of arbitrary nesting. Attachment-point scoping gives the same isolation with no hidden inheritance rule: **the position is the scope.**

**Origin and state are two dimensions, not one list.** Origin is Core (inside the package), Local (your repo) or Community (registry). State is **derived from code, never a config flag** — `off` means the line is absent. Core plugins stay listed even when off, so the panel doubles as a catalogue of what the framework offers and you discover `tenancy` and `privacy` by browsing rather than by reading documentation; local and community plugins appear only once plugged.

**The panel is a supply-chain surface, not a catalogue.** A plugin can register a hook on every request, add tables to your schema, read your secrets and inject a Console panel. So contributions are split by risk: **declares** (once at boot — schema, elements, drivers, panels, CLI) versus **intercepts** (per request — hooks, with measured millisecond cost).

**Enforceable rules, chosen against the 2026 threat landscape** in which major packages have been compromised through malicious post-install dependencies:

- **no lifecycle scripts** — an okengine plugin never needs one, and its presence fails `oke doctor`
- **release cooldown** — a version published within the last few days is held unless explicitly overridden
- **source scan** — we already run oxc, so direct `node:` imports that bypass `fx` are detected and displayed
- **provenance** — published from verified CI, or from nowhere
- **identity dedup and boot-time conflict detection** — colliding table, panel or driver names fail the boot naming both sides, never last-write-wins

**No approve command and no plugin lockfile.** Adding a plugin is a code change; **git review is the approval**. Capabilities live in the Manifest, so a version bump that widens them surfaces in Manifest Diff and hits the existing CI gate. One mechanism, not two.

**The honest boundary:** a plugin can `import fs` and do as it pleases with the process — no framework in the world prevents that. What we offer is detection, integrity, a declared capability list, and container-level limits in production. **We claim nothing beyond that.**

**The Console never installs anything.** Installing from a browser means writing to `package.json` and downloading over the network — exactly the back door every other panel was designed to close. It shows state, computes the capability diff, and hands you the command.
