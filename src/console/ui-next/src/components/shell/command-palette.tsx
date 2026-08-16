/**
 * ⌘K command palette — beUI block behavior, Console traces chrome.
 * https://beui.dev/components/blocks/command-palette
 */

import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { filterCommandItems } from "@/components/shell/command-match.ts";
import {
  EXPLORER_ICON_BUTTON_CLASS,
  EXPLORER_ICON_CLASS,
  EXPLORER_LIST_EMPTY_CLASS,
  EXPLORER_RAIL_ACTIVE_CLASS,
  EXPLORER_RAIL_CLASS,
  EXPLORER_ROW_CLASS,
  EXPLORER_ROW_SELECTED_CLASS,
  EXPLORER_SEARCH_CLASS,
  EXPLORER_TOOLBAR_CLASS,
  SECTION_HEAD_CLASS,
} from "@/components/explorer/explorer-chrome.ts";
import { Kbd } from "@/components/ui/kbd";
import { motion, useReducedMotion } from "@/lib/motion";
import { ShortcutKeys } from "@/lib/shortcut-keys.tsx";
import { modChord } from "@/lib/shortcut.ts";
import { cn } from "@/lib/utils.ts";

/** Hugeicons glyph accepted by {@link CommandItem.icon}. */
export type CommandIcon = typeof Search01Icon;

/** One palette row. */
export type CommandItem = {
  readonly id: string;
  readonly label: string;
  readonly group?: string;
  readonly hint?: string;
  /** Key caps shown on the right (⌘ K, G O). */
  readonly keys?: readonly string[];
  readonly keywords?: readonly string[];
  readonly icon?: CommandIcon;
  readonly badge?: ReactNode;
  readonly onSelect: () => void;
};

/** Props for {@link CommandPalette}. */
export interface CommandPaletteProps {
  readonly items: readonly CommandItem[];
  /** Opens with Cmd/Ctrl + this key. Default: `k`. */
  readonly shortcut?: string;
  readonly placeholder?: string;
  readonly emptyMessage?: string;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

/** Ink-only key caps on the search strip — no muted chip. */
const STRIP_KBD =
  "h-auto min-w-0 bg-transparent px-0 font-mono text-[10px] tracking-[0.08em] text-muted-foreground";

const PANEL_SPRING = {
  type: "spring",
  stiffness: 560,
  damping: 40,
  mass: 0.5,
} as const;

/**
 * Always-mounted command palette. Cmd/Ctrl+K toggles it; Escape closes.
 *
 * @param props - Items and optional controlled open state
 */
export function CommandPalette({
  items,
  shortcut = "k",
  placeholder = "Type a command or search…",
  emptyMessage = "No results found.",
  open: controlledOpen,
  onOpenChange,
}: CommandPaletteProps): ReactNode {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const uid = useId();
  const reduce = useReducedMotion();
  const updateQuery = useCallback((value: string) => {
    setQuery(value);
    setActive(0);
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === shortcut.toLowerCase()) {
        event.preventDefault();
        setOpen(!open);
        return;
      }
      if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, shortcut, setOpen]);

  useEffect(() => {
    if (!open) return;
    updateQuery("");
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, updateQuery]);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      root.style.overflow = previousRootOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [open]);

  const filtered = useMemo(() => filterCommandItems(items, query), [items, query]);
  const hasIcons = useMemo(() => items.some((item) => item.icon !== undefined), [items]);
  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const item of filtered) {
      const group = item.group ?? "Results";
      const list = map.get(group) ?? [];
      list.push(item);
      map.set(group, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (filtered.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(filtered.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = filtered[active];
      if (item) {
        item.onSelect();
        setOpen(false);
      }
    }
  };

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!mounted) return null;

  let cursor = 0;
  const openKeys = modChord(shortcut.toUpperCase());

  return createPortal(
    <div
      aria-hidden={!open}
      inert={!open}
      data-slot="command-palette"
      className={cn(
        "fixed inset-0 z-100 flex items-start justify-center px-4 pt-[12vh]",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
    >
      <motion.button
        type="button"
        aria-label="Close command palette"
        initial={false}
        animate={{ opacity: open ? 1 : 0 }}
        transition={{ duration: open ? 0.18 : 0.12 }}
        onClick={() => setOpen(false)}
        className={cn(
          "absolute inset-0 bg-black/20",
          open ? "pointer-events-auto" : "pointer-events-none",
        )}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        initial={false}
        animate={{
          opacity: open ? 1 : 0,
          y: open || reduce ? 0 : -8,
          scale: open || reduce ? 1 : 0.97,
        }}
        transition={reduce ? { duration: 0.1 } : open ? PANEL_SPRING : { duration: 0.12 }}
        onKeyDown={onKeyDown}
        className={cn(
          "relative w-full max-w-xl overflow-hidden rounded-none border border-border bg-popover text-popover-foreground shadow-lg will-change-transform",
          open ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        <div className={EXPLORER_TOOLBAR_CLASS}>
          <span className={cn(EXPLORER_ICON_BUTTON_CLASS, "pointer-events-none")}>
            <HugeiconsIcon icon={Search01Icon} className={EXPLORER_ICON_CLASS} />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            placeholder={placeholder}
            tabIndex={open ? 0 : -1}
            role="combobox"
            aria-expanded={open}
            aria-controls={`${uid}-list`}
            aria-activedescendant={filtered.length > 0 ? `${uid}-opt-${active}` : undefined}
            aria-autocomplete="list"
            className={EXPLORER_SEARCH_CLASS}
          />
          <span className="flex h-full shrink-0 items-center gap-2 pr-2">
            <span className="inline-flex items-center gap-0.5">
              {openKeys.map((key) => (
                <Kbd key={key} className={STRIP_KBD}>
                  {key}
                </Kbd>
              ))}
            </span>
            <Kbd className={STRIP_KBD}>Esc</Kbd>
          </span>
        </div>
        <div
          ref={listRef}
          id={`${uid}-list`}
          role="listbox"
          aria-label="Commands"
          className="max-h-[60vh] overflow-y-auto overscroll-contain"
        >
          {filtered.length === 0 ? (
            <p className={EXPLORER_LIST_EMPTY_CLASS}>{emptyMessage}</p>
          ) : (
            grouped.map(([group, list]) => (
              <div key={group} className="border-b border-border/60 last:border-b-0">
                <div aria-hidden className={cn(SECTION_HEAD_CLASS, "px-2 py-1.5")}>
                  {group}
                </div>
                {list.map((item) => {
                  const idx = cursor;
                  cursor += 1;
                  const isActive = idx === active;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      id={`${uid}-opt-${idx}`}
                      role="option"
                      aria-selected={isActive}
                      data-index={idx}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => {
                        item.onSelect();
                        setOpen(false);
                      }}
                      tabIndex={open ? 0 : -1}
                      className={cn(
                        EXPLORER_ROW_CLASS,
                        "border-b-0",
                        isActive && EXPLORER_ROW_SELECTED_CLASS,
                      )}
                    >
                      {isActive ? (
                        <span className={cn(EXPLORER_RAIL_CLASS, EXPLORER_RAIL_ACTIVE_CLASS)} />
                      ) : null}
                      {Icon ? (
                        <HugeiconsIcon
                          icon={Icon}
                          className="relative z-10 size-3.5 shrink-0 text-muted-foreground"
                        />
                      ) : hasIcons ? (
                        <span className="size-3.5 shrink-0" />
                      ) : null}
                      <span className="relative z-10 min-w-0 flex-1 truncate">{item.label}</span>
                      {item.badge ? (
                        <span className="relative z-10 shrink-0 text-[10px] text-muted-foreground">
                          {item.badge}
                        </span>
                      ) : null}
                      {item.keys && item.keys.length > 0 ? (
                        <ShortcutKeys keys={item.keys} className="relative z-10" />
                      ) : item.hint ? (
                        <span className="relative z-10 shrink-0 text-[10px] text-muted-foreground">
                          {item.hint}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
