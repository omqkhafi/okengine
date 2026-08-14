/**
 * Highlighted SQL / command editor — transparent textarea over AgentCode.
 */

import {
  useImperativeHandle,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type Ref,
} from "react";
import { PlayIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AgentCode, type AgentCodeLanguage } from "@/components/agents/agent-code.tsx";
import { cn } from "@/lib/utils.ts";
import type { QuerySchemaTable } from "../lib/query-schema.ts";
import { completeQuery, type SqlCompleteResult } from "../lib/sql-complete.ts";
import { QueryCompleteList, textareaCaretOffset } from "./query-complete.tsx";

/** Imperative insert / focus for schema clicks. */
export type QueryEditorHandle = {
  insert(text: string): void;
  focus(): void;
};

/** Props for {@link QueryEditor}. */
export interface QueryEditorProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly language: AgentCodeLanguage;
  readonly onRun: () => void;
  /** ⌘⇧Enter — run the whole buffer. */
  readonly onRunAll?: () => void;
  readonly label: string;
  readonly className?: string;
  /** 1-based lines that start a runnable statement. */
  readonly runLines?: readonly number[];
  readonly onRunLine?: (line: number) => void;
  readonly onCursorChange?: (start: number, end: number) => void;
  readonly editorRef?: Ref<QueryEditorHandle | null>;
  /** Manifest tables / KV namespaces for caret completions. */
  readonly tables?: readonly QuerySchemaTable[];
  readonly facet?: "sql" | "kv";
}

/**
 * Line-numbered editor. ⌘/Ctrl+Enter runs; Tab inserts two spaces.
 * Schema-aware completions open as you type (↑↓ Enter/Tab, Esc dismiss).
 *
 * @param props - Buffer + language + run
 */
export function QueryEditor({
  value,
  onChange,
  language,
  onRun,
  onRunAll,
  label,
  className,
  runLines = [],
  onRunLine,
  onCursorChange,
  editorRef,
  tables = [],
  facet = "sql",
}: QueryEditorProps): JSX.Element {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const highRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{
    readonly result: SqlCompleteResult;
    readonly active: number;
    readonly top: number;
    readonly left: number;
  } | null>(null);
  const lineCount = Math.max(value.split("\n").length, 1);
  const highlight = value.endsWith("\n") ? value : `${value}\n`;
  const runSet = new Set(runLines);

  useImperativeHandle(editorRef, () => ({
    insert(text: string) {
      const el = areaRef.current;
      setMenu(null);
      if (!el) {
        onChange(`${value}${text}`);
        return;
      }
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = `${value.slice(0, start)}${text}${value.slice(end)}`;
      onChange(next);
      requestAnimationFrame(() => {
        const caret = start + text.length;
        el.focus();
        el.selectionStart = el.selectionEnd = caret;
        onCursorChange?.(caret, caret);
      });
    },
    focus() {
      areaRef.current?.focus();
    },
  }));

  const syncScroll = (): void => {
    const el = areaRef.current;
    if (!el) return;
    if (gutterRef.current) gutterRef.current.scrollTop = el.scrollTop;
    if (highRef.current) {
      highRef.current.scrollTop = el.scrollTop;
      highRef.current.scrollLeft = el.scrollLeft;
    }
  };

  const emitCursor = (): void => {
    const el = areaRef.current;
    if (!el) return;
    onCursorChange?.(el.selectionStart, el.selectionEnd);
  };

  const placeCaret = (el: HTMLTextAreaElement, pos: number): void => {
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = pos;
      onCursorChange?.(pos, pos);
    });
  };

  const refreshComplete = (el: HTMLTextAreaElement, nextValue: string): void => {
    if (tables.length === 0) {
      setMenu(null);
      return;
    }
    const cursor = el.selectionStart;
    const result = completeQuery(nextValue, cursor, tables, facet);
    if (!result) {
      setMenu(null);
      return;
    }
    const pos = textareaCaretOffset(el, cursor);
    setMenu({
      result,
      active: 0,
      top: Math.min(pos.top + 20, Math.max(8, el.clientHeight - 48)),
      left: Math.min(Math.max(8, pos.left), Math.max(8, el.clientWidth - 220)),
    });
  };

  const acceptComplete = (index: number): void => {
    const el = areaRef.current;
    if (!el || !menu) return;
    const item = menu.result.items[index];
    if (!item) return;
    const next = `${value.slice(0, menu.result.from)}${item.insert}${value.slice(menu.result.to)}`;
    const caret = menu.result.from + item.insert.length;
    onChange(next);
    setMenu(null);
    placeCaret(el, caret);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      setMenu(null);
      if (event.shiftKey && onRunAll) onRunAll();
      else onRun();
      return;
    }
    if (menu) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMenu((prev) =>
          prev ? { ...prev, active: (prev.active + 1) % prev.result.items.length } : prev,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMenu((prev) =>
          prev
            ? {
                ...prev,
                active: (prev.active - 1 + prev.result.items.length) % prev.result.items.length,
              }
            : prev,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        acceptComplete(menu.active);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMenu(null);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        setMenu(null);
      }
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const el = event.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = `${value.slice(0, start)}  ${value.slice(end)}`;
      onChange(next);
      placeCaret(el, start + 2);
      return;
    }
    if (event.key === "Escape") setMenu(null);
  };

  return (
    <div
      className={cn("flex min-h-0 flex-1 overflow-hidden bg-background", className)}
      data-slot="store-query-editor"
    >
      <div
        ref={gutterRef}
        aria-hidden
        className="shrink-0 overflow-hidden border-r border-border/50 bg-muted/15 py-3 pr-1.5 pl-1.5 font-mono text-xs leading-5 text-muted-foreground/70"
      >
        {Array.from({ length: lineCount }, (_, i) => {
          const line = i + 1;
          const runnable = runSet.has(line);
          return (
            <div key={line} className="group/line flex h-5 items-center justify-end gap-0.5">
              {runnable && onRunLine ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Run statement on line ${line}`}
                  data-slot="store-query-gutter-run"
                  onClick={() => onRunLine(line)}
                  className="flex size-4 items-center justify-center rounded-sm text-emerald-600 opacity-70 hover:bg-emerald-500/15 hover:opacity-100 dark:text-emerald-400"
                >
                  <HugeiconsIcon icon={PlayIcon} className="size-2.5" />
                </button>
              ) : (
                <span className="size-4" />
              )}
              <span className="min-w-4 text-right">{line}</span>
            </div>
          );
        })}
      </div>
      <div className="relative min-h-0 min-w-0 flex-1">
        <div ref={highRef} className="pointer-events-none absolute inset-0 overflow-hidden">
          <AgentCode code={highlight} language={language} className="px-3 py-3 text-xs leading-5" />
        </div>
        <textarea
          ref={areaRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            onCursorChange?.(e.target.selectionStart, e.target.selectionEnd);
            refreshComplete(e.target, e.target.value);
          }}
          onScroll={syncScroll}
          onKeyDown={onKeyDown}
          onKeyUp={emitCursor}
          onClick={() => {
            setMenu(null);
            emitCursor();
          }}
          onSelect={emitCursor}
          onBlur={() => setMenu(null)}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={menu !== null}
          aria-controls={menu ? "store-query-complete" : undefined}
          aria-activedescendant={menu ? `store-query-complete-${menu.active}` : undefined}
          data-slot="store-query-input"
          className="absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent px-3 py-3 font-mono text-xs leading-5 text-transparent caret-foreground outline-none"
        />
        {menu ? (
          <QueryCompleteList
            items={menu.result.items}
            active={menu.active}
            top={menu.top}
            left={menu.left}
            onHover={(index) => setMenu((prev) => (prev ? { ...prev, active: index } : prev))}
            onPick={acceptComplete}
          />
        ) : null}
      </div>
    </div>
  );
}
