/**
 * Minimal fixed-position context menu for the Store data grid — closes on
 * outside pointerdown, Escape, scroll, or resize.
 */

import { useEffect, useRef, type ComponentProps, type JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";

/** One menu entry — either an action or a visual separator. */
export type StoreGridMenuItem =
  | { readonly type: "separator" }
  | {
      readonly type?: "action";
      readonly label: string;
      readonly shortcut?: string;
      readonly icon?: ComponentProps<typeof HugeiconsIcon>["icon"];
      readonly destructive?: boolean;
      readonly disabled?: boolean;
      readonly onSelect: () => void;
    };

/** Props for {@link StoreGridContextMenu}. */
export interface StoreGridContextMenuProps {
  readonly x: number;
  readonly y: number;
  readonly items: readonly StoreGridMenuItem[];
  readonly onClose: () => void;
}

/**
 * Right-click menu anchored at cursor coordinates, clamped to the viewport.
 *
 * @param props - Position + items + close callback
 */
export function StoreGridContextMenu({
  x,
  y,
  items,
  onClose,
}: StoreGridContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    const onDismiss = () => onClose();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", onDismiss, true);
    window.addEventListener("resize", onDismiss);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("resize", onDismiss);
    };
  }, [onClose]);

  const estimatedHeight = items.length * 30 + 12;
  const style = {
    top: Math.max(8, Math.min(y, window.innerHeight - estimatedHeight - 8)),
    left: Math.max(8, Math.min(x, window.innerWidth - 208)),
  } as const;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Cell actions"
      data-slot="store-grid-context-menu"
      className="fixed z-50 min-w-52 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      style={style}
    >
      {items.map((item, index) =>
        item.type === "separator" ? (
          <div key={`sep-${index}`} role="separator" className="-mx-1 my-1 h-px bg-border" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] outline-none select-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50",
              item.destructive && "text-destructive hover:bg-destructive/10",
            )}
          >
            {item.icon ? (
              <HugeiconsIcon icon={item.icon} className="size-3.5 shrink-0" aria-hidden />
            ) : null}
            <span className="min-w-0 truncate">{item.label}</span>
            {item.shortcut ? (
              <span className="ml-auto pl-4 font-mono text-[10px] tracking-widest text-muted-foreground">
                {item.shortcut}
              </span>
            ) : null}
          </button>
        ),
      )}
    </div>
  );
}
