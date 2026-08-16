/**
 * Console-wide chords: ⌘, opens Settings; ⌘E logs out; ⌘1…⌘N hop modules.
 * ⌘K stays on the command palette. Ctrl on Windows.
 */

import { useEffect, useRef } from "react";
import { isTypingTarget, MODULE_DIGIT_PATH } from "@/lib/shortcut.ts";
import type { ConsoleModulePath } from "@/lib/last-module-search.ts";

/** Handlers for {@link useConsoleShortcuts}. */
export interface ConsoleShortcutHandlers {
  readonly enabled: boolean;
  readonly go: (path: ConsoleModulePath) => void;
  readonly openSettings: () => void;
  readonly logout: () => void;
}

/**
 * Bind Settings and numbered module hops while the shell is idle.
 *
 * @param handlers - Navigate / settings + enable flag
 */
export function useConsoleShortcuts(handlers: ConsoleShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const { enabled, go, openSettings, logout } = handlersRef.current;
      if (!enabled || event.repeat) return;
      if (isTypingTarget(event.target)) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;

      if (event.key === ",") {
        event.preventDefault();
        openSettings();
        return;
      }

      if (event.key.toLowerCase() === "e") {
        event.preventDefault();
        logout();
        return;
      }

      const path = MODULE_DIGIT_PATH[event.key];
      if (path) {
        event.preventDefault();
        go(path);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
