/**
 * Remember each Console module's last URL search so sidebar hops
 * restore Overview / Flows / Store / Observability / Vault instead of wiping them.
 */

/** Authenticated Console modules that own URL search. */
export const CONSOLE_MODULE_PATHS = [
  "/overview",
  "/flows",
  "/store",
  "/observability",
  "/vault",
] as const;

/** Pathname for a Console module. */
export type ConsoleModulePath = (typeof CONSOLE_MODULE_PATHS)[number];

/** Last search object per module. */
export type LastModuleSearch = Partial<Record<ConsoleModulePath, Record<string, unknown>>>;

/** sessionStorage key for {@link LastModuleSearch}. */
export const LAST_MODULE_SEARCH_KEY = "oke.console.last-module-search";

/**
 * Whether `path` is a Console module that stores search.
 *
 * @param path - Location pathname
 */
export function isConsoleModulePath(path: string): path is ConsoleModulePath {
  return (CONSOLE_MODULE_PATHS as readonly string[]).includes(path);
}

/**
 * Copy a router search value into a plain object.
 *
 * @param search - TanStack `location.search` (object or unknown)
 */
export function asSearchRecord(search: unknown): Record<string, unknown> {
  if (search === null || typeof search !== "object" || Array.isArray(search)) return {};
  return { ...(search as Record<string, unknown>) };
}

/**
 * Whether two search records have the same keys and values.
 *
 * @param left - First record
 * @param right - Second record
 */
export function sameSearchRecord(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown>,
): boolean {
  if (left === undefined) return Object.keys(right).length === 0;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

/**
 * Record `search` for `path` (no-op when path is not a module).
 *
 * @param memory - Current map
 * @param path - Location pathname
 * @param search - Parsed search
 */
export function rememberModuleSearch(
  memory: LastModuleSearch,
  path: string,
  search: Record<string, unknown>,
): LastModuleSearch {
  const modulePath = path === "/monitoring" ? "/observability" : path;
  if (!isConsoleModulePath(modulePath)) return memory;
  if (sameSearchRecord(memory[modulePath], search)) return memory;
  return { ...memory, [modulePath]: { ...search } };
}

/**
 * Last search for a module, or empty.
 *
 * @param memory - Current map
 * @param path - Module path
 */
export function lastSearchFor(
  memory: LastModuleSearch,
  path: ConsoleModulePath,
): Record<string, unknown> {
  return memory[path] ?? {};
}

/**
 * Parse sessionStorage JSON into {@link LastModuleSearch}.
 *
 * @param raw - Stored string
 */
export function parseLastModuleSearch(raw: string | null): LastModuleSearch {
  if (raw === null || raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: LastModuleSearch = {};
    const record = parsed as Record<string, unknown>;
    for (const path of CONSOLE_MODULE_PATHS) {
      const value = record[path];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        out[path] = { ...(value as Record<string, unknown>) };
      }
    }
    const legacy = record["/monitoring"];
    if (
      out["/observability"] === undefined &&
      legacy &&
      typeof legacy === "object" &&
      !Array.isArray(legacy)
    ) {
      out["/observability"] = { ...(legacy as Record<string, unknown>) };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Load remembered search from sessionStorage.
 *
 * @param storage - sessionStorage (injectable)
 */
export function loadLastModuleSearch(
  storage: Pick<Storage, "getItem"> | null = defaultSession(),
): LastModuleSearch {
  if (!storage) return {};
  try {
    return parseLastModuleSearch(storage.getItem(LAST_MODULE_SEARCH_KEY));
  } catch {
    return {};
  }
}

/**
 * Persist remembered search to sessionStorage.
 *
 * @param memory - Current map
 * @param storage - sessionStorage (injectable)
 */
export function saveLastModuleSearch(
  memory: LastModuleSearch,
  storage: Pick<Storage, "setItem"> | null = defaultSession(),
): void {
  if (!storage) return;
  try {
    storage.setItem(LAST_MODULE_SEARCH_KEY, JSON.stringify(memory));
  } catch {
    /* quota / private mode */
  }
}

function defaultSession(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}
