---
title: "Plugins"
description: "The extensibility law — public plugin API only."
icon: "Puzzle"
source: "docs/spec/unified-theory.md"
---

### 14. Plugins — the extensibility law

A plugin is a function that receives the app, adds capabilities, and returns it **with accumulated types.** A plugin may contribute: flows, hooks, context decorations, elements, drivers, image recipes, DB schema, typed errors, client extensions, CLI commands, and Console panels.

Plugins may declare additional tables (with columns) that are merged into the generated domain schema. At `oke db` time the CLI loads the live app entry (`src/app.ts` / `db.entry`), reads plugged plugins’ table contributions, and emits them alongside app `store.schema.table` decls into `schema.generated.ts`. Extending an existing app-owned table with plugin columns is not supported in v1 — contribute a separate table instead.

> **Guarantee:** every built-in feature — auth, Console, docker derivation, channels — uses only the public plugin API. If the core team ever needs a private hook, the API is broken and gets fixed.
