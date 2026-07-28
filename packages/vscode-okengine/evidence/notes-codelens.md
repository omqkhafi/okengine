# CodeLens evidence — examples/notes

Extractor: real `extractManifest` / `lensesForFile` (not a parallel parser).
File: `src/flows/notes/index.ts`

| Line (1-based) | Flow | CodeLens title |
|---:|---|---|
| 14 | `create` | `effects → writes[sql:notes]` |
| 24 | `list` | `effects → reads[sql:notes]` |
| 30 | `get` | `effects → reads[sql:notes]` |
| 37 | `remove` | `effects → writes[sql:notes]` |
