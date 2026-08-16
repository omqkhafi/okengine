---
name: oke-console-style
description: >-
  Redesigns Console UI to the Overview traces language — flush strips,
  flat fill, hairline /60, no boxed wells. Use when the user says
  redesign, flat fill, match our style, traces language, explorer
  chrome, or selects a Console toolbar, tab, list, sidebar, or picker
  that looks pill-shaped, blurred, or boxed.
---

# OKE Console style — redesign to traces

Source of truth is **Overview traces**, not a generic dashboard look.

Read before editing:

1. [`src/console/ui-next/src/components/explorer/explorer-chrome.ts`](../../../src/console/ui-next/src/components/explorer/explorer-chrome.ts) — tokens
2. [`src/console/ui-next/src/features/flows/traces/trace-row.tsx`](../../../src/console/ui-next/src/features/flows/traces/trace-row.tsx) — leaf row
3. [`src/console/ui-next/src/features/flows/traces/traces-pane.tsx`](../../../src/console/ui-next/src/features/flows/traces/traces-pane.tsx) — toolbar + filter strip

Token names and “what you see → token” live in [tokens.md](tokens.md). Do not invent new chrome classes if a token already exists.

## The law

- **Flat fill.** Hover `bg-muted/50` fills the **full strip or row height**. Selected **lists** use `bg-muted/70` + a full-height sky rail. Selected **strip tokens** are ink only (`EXPLORER_STRIP_TOKEN_ACTIVE_CLASS`) — no pill, no muted chip.
- **Hairline** `border-border/60`. Not `/50`. No muted band fill (`bg-muted`, `bg-muted/10`) on toolbars or rails.
- **Bare icons.** No bordered 24px wells on strips. `EXPLORER_ICON_BUTTON_CLASS` is a stretch token. In-row actions use `EXPLORER_ICON_BUTTON_BARE_CLASS`.
- **Tracking `0.08em`** on section / band / tab labels (`SECTION_HEAD_CLASS`). Not `0.14em`.
- **Tabular counts**, no bordered count chips.
- **Hover-reveal** secondary actions on rows / bands.

## Do not rewrite primitives

Adjust the **call site**. Do not restyle `Button`, `Checkbox`, `Sidebar`, `DropdownMenu`, or motion table internals.

- Override classes on the consumer (`className`, `ToolbarTip className="flex self-stretch"`).
- Spreadsheet cell selection stays sky. ERD schema cards stay clustered color cards.
- Teaching figures that carry meaning stay (e.g. Gate access diagrams). Decorative hover chrome does not.

## Workflow

```
Task:
- [ ] 1. Name the surface (strip / toolbar / row / band / detail / rail)
- [ ] 2. Read explorer-chrome.ts + the traces exemplar
- [ ] 3. Map to existing tokens — see tokens.md
- [ ] 4. Edit the call site only
- [ ] 5. Check icon-collapsed / empty / selected / hover-fill height
- [ ] 6. Keep data-slot attributes
- [ ] 7. oxfmt + oxlint; changelog via oke-ship
```

**Strip / tabs / command bar** → `EXPLORER_STRIP_CLASS` + `EXPLORER_STRIP_TOKEN_*`. Parent `items-stretch`. `ToolbarTip` must be `flex self-stretch` or hover is a pill.

**Search toolbar** → `EXPLORER_TOOLBAR_CLASS` + `ExplorerSearch`. Icon actions stretch with `EXPLORER_ICON_BUTTON_CLASS`.

**List** → `EXPLORER_ROW_CLASS` + rail + `EXPLORER_ROW_SELECTED_CLASS`. Bands use `EXPLORER_BAND_*`.

**Icon-collapsed sidebar** → hide labels (`sr-only`). Center the icon. Do **not** set `size-auto` — that leaks truncated titles. Full-rail width + `h-10` + `p-0` + `rounded-none`.

**Command / Query / identity headers** → `EXPLORER_STRIP_CLASS` / `DETAIL_HEADER_CLASS` (h-10, no blur). Bare icon — no well. Title + badges + actions on one line. Sidebar brand cell is the same height.

## Reject on sight

| Smell                                             | Fix                                             |
| ------------------------------------------------- | ----------------------------------------------- |
| `rounded-md` + `bg-muted` tab / chip              | Strip token, ink when active                    |
| `size="icon-xs"` / `variant="secondary"` on a bar | Stretch token / ghost + ink                     |
| `backdrop-blur` / `bg-background/95` on a header  | `DETAIL_HEADER_CLASS` or `EXPLORER_STRIP_CLASS` |
| `border-border/50` on explorer chrome             | `/60`                                           |
| `tracking-[0.14em]`                               | `0.08em` / `SECTION_HEAD_CLASS`                 |
| Hover is a rounded square inside an `h-10`        | `items-stretch` + full-height token             |
| Collapsed nav shows `O…` / `Fl…`                  | `sr-only` label, keep icon box                  |

## Close-out

User-visible Console chrome → [oke-ship](../oke-ship/SKILL.md) changelog under `## Unreleased`. No site docs unless a public Console page describes the control.
