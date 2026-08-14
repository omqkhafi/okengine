/**
 * Hover capability — gate decorative hover motion on fine pointers.
 *
 * @see https://beui.dev/r/button-stateful
 */

import { useEffect, useState } from "react";

/**
 * True only on devices with a real hover (mouse / trackpad).
 * Touch fires a sticky phantom `:hover` — skip hover-only lifts behind this.
 *
 * @returns Whether hover-driven motion should run
 */
export function useHoverCapable(): boolean {
  const [canHover, setCanHover] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = (): void => {
      setCanHover(mq.matches);
    };
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return canHover;
}
