/**
 * Caret-anchored completion list for the query editor.
 */

import type { JSX } from "react";
import { cn } from "@/lib/utils.ts";
import type { SqlCompletion } from "../lib/sql-complete.ts";
import { SchemaColumnMarks } from "../schema/schema-constraint-icon.tsx";

/** Props for {@link QueryCompleteList}. */
export interface QueryCompleteListProps {
  readonly items: readonly SqlCompletion[];
  readonly active: number;
  readonly top: number;
  readonly left: number;
  readonly onHover: (index: number) => void;
  readonly onPick: (index: number) => void;
}

/**
 * Schema / keyword completion popup.
 *
 * @param props - Items + caret offset
 */
export function QueryCompleteList({
  items,
  active,
  top,
  left,
  onHover,
  onPick,
}: QueryCompleteListProps): JSX.Element {
  return (
    <ul
      id="store-query-complete"
      role="listbox"
      data-slot="store-query-complete"
      className="cn-menu-translucent absolute z-20 max-h-56 min-w-52 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      style={{ top, left }}
    >
      {items.map((item, index) => (
        <li key={`${item.kind}:${item.label}:${item.detail ?? ""}`}>
          <button
            type="button"
            role="option"
            id={`store-query-complete-${index}`}
            aria-selected={index === active}
            data-slot="store-query-complete-item"
            onMouseEnter={() => onHover(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(index);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left",
              index === active
                ? "bg-accent text-accent-foreground"
                : "text-foreground hover:bg-muted/70",
            )}
          >
            <SchemaColumnMarks primaryKey={item.primaryKey} foreignKey={item.foreignKey} />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{item.label}</span>
            {item.pii ? (
              <span className="shrink-0 rounded border border-sky-500/30 px-1 font-mono text-[8px] text-sky-700 dark:text-sky-400">
                PII
              </span>
            ) : null}
            <span className="shrink-0 font-mono text-[9px] tracking-wide text-muted-foreground/70 uppercase">
              {item.kind === "column" ? (item.detail ?? "col") : item.kind}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Mirror-div caret offset inside a textarea (same font / padding).
 *
 * @param el - Editor
 * @param pos - Caret offset
 */
export function textareaCaretOffset(
  el: HTMLTextAreaElement,
  pos: number,
): { readonly top: number; readonly left: number } {
  const style = getComputedStyle(el);
  const div = document.createElement("div");
  const props = [
    "boxSizing",
    "width",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "textTransform",
    "wordSpacing",
    "textIndent",
    "whiteSpace",
    "wordWrap",
    "lineHeight",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
  ] as const;
  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.overflow = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";
  for (const prop of props) {
    div.style[prop] = style[prop];
  }
  div.style.width = `${el.clientWidth}px`;
  div.textContent = el.value.slice(0, pos);
  const span = document.createElement("span");
  span.textContent = el.value.slice(pos) || ".";
  div.appendChild(span);
  document.body.appendChild(div);
  const top = span.offsetTop - el.scrollTop;
  const left = span.offsetLeft - el.scrollLeft;
  document.body.removeChild(div);
  return { top, left };
}
