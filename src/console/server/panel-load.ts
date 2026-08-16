/**
 * Lazy Console panel module loader — expression `new URL` keeps panel
 * backends out of the createConsoleState / createConsoleApp graph until
 * first access (mirrors kernel boot-bind).
 */

/** Panel ids that own server-side projection / mutation modules. */
export type ConsolePanelId =
  | "access"
  | "gates"
  | "signals"
  | "store"
  | "clock"
  | "instances"
  | "vault"
  | "ai"
  | "channels"
  | "plugins"
  | "diff";

/**
 * Load a Console panel module by id without bundling it into the parent.
 *
 * @param id - Panel module stem (`store`, `vault`, …)
 */
export async function loadConsolePanel<T>(id: ConsolePanelId): Promise<T> {
  const url = new URL(`./${id}.ts`, import.meta.url);
  return import(url.href) as Promise<T>;
}
