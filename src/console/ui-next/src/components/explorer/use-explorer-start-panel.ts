/**
 * Collapse / expand the start panel of an explorer split.
 */

import { useState } from "react";
import { usePanelRef } from "@/components/ui/resizable";

/**
 * Imperative start-panel collapse for a horizontal explorer split.
 *
 * @returns Panel ref, open flag, toggle, and resize sync
 */
export function useExplorerStartPanel() {
  const panelRef = usePanelRef();
  const [open, setOpen] = useState(true);

  const toggle = () => {
    const panel = panelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
      setOpen(true);
    } else {
      panel.collapse();
      setOpen(false);
    }
  };

  const onResize = () => {
    setOpen(!(panelRef.current?.isCollapsed() ?? false));
  };

  return { panelRef, open, toggle, onResize };
}
