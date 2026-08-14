/**
 * Portaled row-border handle for insert/delete.
 */

import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete02Icon,
  MoreVerticalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, type JSX } from "react";
import { createPortal } from "react-dom";
import { TableMenu } from "./table-menu.tsx";

/** Props for {@link RowHandle}. */
export interface RowHandleProps {
  readonly rowEl: HTMLTableRowElement | null;
  readonly id: string;
  readonly index: number;
  readonly onInsertRow?: (index: number, position: "before" | "after") => void;
  readonly onDeleteRow?: (rowId: string, index: number) => void;
  readonly onEnter: () => void;
  readonly onLeave: () => void;
}

/**
 * Sit on the row's left border without the scroll container clipping it.
 *
 * @param props - Target row + insert/delete callbacks
 */
export function RowHandle({
  rowEl,
  id,
  index,
  onInsertRow,
  onDeleteRow,
  onEnter,
  onLeave,
}: RowHandleProps): JSX.Element | null {
  useEffect(() => {
    window.addEventListener("scroll", onLeave, true);
    return () => window.removeEventListener("scroll", onLeave, true);
  }, [onLeave]);

  if (!rowEl || typeof document === "undefined") return null;
  const rect = rowEl.getBoundingClientRect();

  return createPortal(
    <div
      style={{
        position: "fixed",
        top: rect.top + rect.height / 2,
        left: rect.left,
        transform: "translate(-50%, -50%)",
        zIndex: 40,
      }}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <TableMenu
        ariaLabel={`Row ${index + 1} options`}
        triggerClassName="flex h-6 w-2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        trigger={<HugeiconsIcon icon={MoreVerticalIcon} className="size-3" />}
        items={[
          ...(onInsertRow
            ? [
                {
                  label: "Insert before",
                  icon: <HugeiconsIcon icon={ArrowUp01Icon} />,
                  onSelect: () => onInsertRow(index, "before"),
                },
                {
                  label: "Insert after",
                  icon: <HugeiconsIcon icon={ArrowDown01Icon} />,
                  onSelect: () => onInsertRow(index, "after"),
                },
              ]
            : []),
          ...(onDeleteRow
            ? [
                {
                  label: "Delete row",
                  icon: <HugeiconsIcon icon={Delete02Icon} />,
                  destructive: true,
                  onSelect: () => onDeleteRow(id, index),
                },
              ]
            : []),
        ]}
      />
    </div>,
    document.body,
  );
}
