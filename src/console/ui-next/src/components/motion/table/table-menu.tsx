/**
 * Portaled dropdown used by row/column handles on the motion Table.
 */

import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SPRING_PANEL } from "@/lib/ease.ts";
import { motion, useReducedMotion } from "@/lib/motion.ts";
import { cn } from "@/lib/utils.ts";

/** One menu entry. */
export type TableMenuItem = {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly onSelect: () => void;
  readonly destructive?: boolean;
};

const MENU_WIDTH = 188;

/** Props for {@link TableMenu}. */
export interface TableMenuProps {
  readonly items: readonly TableMenuItem[];
  readonly ariaLabel: string;
  readonly trigger: ReactNode;
  readonly triggerClassName?: string;
}

/**
 * Click-to-open menu anchored to a handle trigger.
 *
 * @param props - Items + trigger
 */
export function TableMenu({
  items,
  ariaLabel,
  trigger,
  triggerClassName,
}: TableMenuProps): JSX.Element {
  const reduce = useReducedMotion();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const open = coords !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setCoords(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setCoords(null);
      return;
    }
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({
      top: r.bottom + 4,
      left: Math.max(8, r.right - MENU_WIDTH),
    });
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && coords && typeof document !== "undefined"
        ? createPortal(
            <>
              <div className="fixed inset-0 z-40" onPointerDown={() => setCoords(null)} />
              <motion.div
                role="menu"
                className="fixed z-50 overflow-hidden rounded-xl border border-border bg-background p-1 shadow-xl"
                style={{ top: coords.top, left: coords.left, width: MENU_WIDTH }}
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                transition={reduce ? { duration: 0 } : SPRING_PANEL}
              >
                {items.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setCoords(null);
                      item.onSelect();
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors [&_svg]:size-4",
                      item.destructive
                        ? "text-rose-500 hover:bg-rose-500/10"
                        : "text-foreground hover:bg-muted",
                    )}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                ))}
              </motion.div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}
