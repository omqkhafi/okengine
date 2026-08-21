/**
 * Console keyboard chords — platform-aware modifier + shared ids.
 */

import type { ConsoleModulePath } from "@/lib/last-module-search.ts";

type NavigatorHints = {
  readonly platform?: string;
  readonly userAgent?: string;
  readonly userAgentData?: { readonly platform?: string };
};

/**
 * True on Apple platforms (⌘ instead of Ctrl).
 *
 * Prefers Client Hints, then UA + `platform` — `navigator.platform` is
 * often empty or frozen in Chromium.
 *
 * @param nav - Browser navigator (injectable for tests)
 */
export function isMacPlatform(nav: NavigatorHints | undefined = globalThis.navigator): boolean {
  if (nav === undefined) return false;
  const hint = nav.userAgentData?.platform;
  if (typeof hint === "string" && hint.length > 0) return /mac/i.test(hint);
  return /Mac|iPhone|iPad|iPod/.test(`${nav.platform ?? ""} ${nav.userAgent ?? ""}`);
}

/**
 * Modifier key label for the current platform.
 *
 * @param nav - Browser navigator (injectable for tests)
 */
export function modKey(nav?: NavigatorHints): string {
  return isMacPlatform(nav) ? "⌘" : "Ctrl";
}

/**
 * Cmd/Ctrl + `key` chord.
 *
 * @param key - Letter or symbol after the modifier
 * @param nav - Browser navigator (injectable for tests)
 */
export function modChord(key: string, nav?: NavigatorHints): readonly string[] {
  return [modKey(nav), key];
}

/**
 * Cmd/Ctrl + Shift + `key` chord.
 *
 * @param key - Letter after the modifiers
 * @param nav - Browser navigator (injectable for tests)
 */
export function modShiftChord(key: string, nav?: NavigatorHints): readonly string[] {
  return isMacPlatform(nav) ? [modKey(nav), "⇧", key] : [modKey(nav), "Shift", key];
}

/** Named Console chords shown in tooltips and the command palette. */
export type ConsoleShortcutId =
  | "fast"
  | "settings"
  | "logout"
  | "overview"
  | "flows"
  | "store"
  | "vault"
  | "access"
  | "observability";

const MODULE_DIGIT: Readonly<
  Record<Exclude<ConsoleShortcutId, "fast" | "settings" | "logout">, string>
> = {
  overview: "1",
  flows: "2",
  store: "3",
  observability: "4",
  vault: "5",
  access: "6",
};

/**
 * Key caps for a named Console shortcut.
 *
 * @param id - Shortcut id
 */
export function consoleShortcut(id: ConsoleShortcutId): readonly string[] {
  if (id === "fast") return modChord("K");
  if (id === "settings") return modChord(",");
  if (id === "logout") return modChord("E");
  return modChord(MODULE_DIGIT[id]);
}

/** Module path for ⌘1…⌘N hops (sidebar order). */
export const MODULE_DIGIT_PATH: Readonly<Record<string, ConsoleModulePath>> = {
  "1": "/overview",
  "2": "/flows",
  "3": "/store",
  "4": "/observability",
  "5": "/vault",
  "6": "/access",
};

/**
 * True when the event target is an editor or overlay that should keep keys.
 *
 * @param target - `keydown` target
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null || typeof HTMLElement === "undefined") return false;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.closest('[role="dialog"], [data-slot="command-palette"]') !== null;
}
