---
title: "Plugins"
description: "The extensibility law — public plugin API only."
icon: "Puzzle"
source: "docs/spec/unified-theory.md"
---

### 14. Plugins — the extensibility law

A plugin is a function that receives the app, adds capabilities, and returns it **with accumulated types.** A plugin may contribute: flows, hooks, context decorations, elements, drivers, image recipes, DB schema, typed errors, client extensions, CLI commands, and Console panels.

> **Guarantee:** every built-in feature — auth, Console, docker derivation, channels — uses only the public plugin API. If the core team ever needs a private hook, the API is broken and gets fixed.
