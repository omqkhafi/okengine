# Console chrome tokens

Import from `@/components/explorer/explorer-chrome.ts`. Class strings live there — copy names, not memories.

## Surfaces

| Surface | Token |
| --- | --- |
| Page shell | `EXPLORER_PAGE_CLASS` |
| Left / right split | `EXPLORER_SPLIT` |
| Search + icon row | `EXPLORER_TOOLBAR_CLASS` + `EXPLORER_SEARCH_CLASS` |
| Filter / command / results / tabs | `EXPLORER_STRIP_CLASS` |
| Token in a strip | `EXPLORER_STRIP_TOKEN_CLASS` |
| Strip selected / idle | `EXPLORER_STRIP_TOKEN_ACTIVE_CLASS` / `EXPLORER_STRIP_TOKEN_IDLE_CLASS` |
| Strip selected + wash | `EXPLORER_STRIP_TOKEN_SELECTED_CLASS` (`bg-muted/70`) |
| Icon on a strip or toolbar | `EXPLORER_ICON_BUTTON_CLASS` |
| Icon on a band / folder row | `EXPLORER_ICON_BUTTON_BARE_CLASS` |
| Facet band | `EXPLORER_BAND_CLASS` + `EXPLORER_BAND_HEADER_CLASS` + `EXPLORER_BAND_LABEL_CLASS` |
| Count | `EXPLORER_COUNT_CLASS` |
| Leaf row | `EXPLORER_ROW_CLASS` + `EXPLORER_ROW_SELECTED_CLASS` |
| Selection rail | `EXPLORER_RAIL_CLASS` + `EXPLORER_RAIL_ACTIVE_CLASS` (`bg-sky-500`) |
| Folder row | `EXPLORER_GROUP_ROW_CLASS` |
| Bare icon / chevron | `EXPLORER_ICON_CLASS` / `EXPLORER_CHEVRON_CLASS` |
| Hover-reveal row actions | `EXPLORER_BAND_ACTIONS_CLASS` |
| Section eyebrow | `SECTION_HEAD_CLASS` |
| Narrow empty copy | `EXPLORER_LIST_EMPTY_CLASS` |
| Inspector identity header | `DETAIL_HEADER_CLASS` (h-10 strip) + `DETAIL_TITLE_CLASS` |

`explorerIconInk(wellClass)` — keep only `text-*` from a well spec for a bare icon.

## Exemplars

| Pattern | File |
| --- | --- |
| Leaf + rail + hover-reveal | `src/console/ui-next/src/features/flows/traces/trace-row.tsx` |
| Search toolbar + filter strip | `src/console/ui-next/src/features/flows/traces/traces-pane.tsx` |
| Query results strip | `src/console/ui-next/src/features/store/query/query-results.tsx` |
| Gate picker | `src/console/ui-next/src/features/store/query/query-gate-parts.tsx` |
| Icon rail (call-site override) | `src/console/ui-next/src/components/shell/app-sidebar.tsx` |
