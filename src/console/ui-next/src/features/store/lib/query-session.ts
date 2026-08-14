/**
 * Query console tabs + saved queries (localStorage) and run history (sessionStorage).
 */

import type { StoreQueryFacet } from "../state/store-selection.ts";

/** One editor tab. */
export type QueryTab = {
  readonly id: string;
  readonly title: string;
  readonly text: string;
};

/** One recorded run. */
export type QueryHistoryEntry = {
  readonly id: string;
  readonly at: number;
  readonly storeRef: string;
  readonly text: string;
  readonly ok: boolean;
  readonly rowCount: number | null;
  readonly durationMs: number;
  readonly error?: string;
};

const TAB_CAP = 8;
const HISTORY_CAP = 24;
const SAVED_CAP = 24;

/**
 * True when the title is still the auto `Query N` placeholder.
 *
 * @param title - Tab title
 */
export function isDefaultQueryTitle(title: string): boolean {
  return /^Query \d+$/.test(title);
}

/**
 * Next `Query N` title that is not already used.
 *
 * @param tabs - Existing tabs
 */
export function nextQueryTitle(tabs: readonly QueryTab[]): string {
  const used = new Set(tabs.map((t) => t.title));
  let n = 1;
  while (used.has(`Query ${n}`)) n += 1;
  return `Query ${n}`;
}

/**
 * Append a tab. Caps at {@link TAB_CAP}.
 *
 * @param tabs - Existing tabs
 * @param text - Seed buffer
 */
export function addQueryTab(tabs: readonly QueryTab[], text: string): readonly QueryTab[] {
  if (tabs.length >= TAB_CAP) return tabs;
  return [
    ...tabs,
    {
      id: newTabId(),
      title: nextQueryTitle(tabs),
      text,
    },
  ];
}

/**
 * Remove a tab. Always leaves at least one (re-seeds when emptying).
 *
 * @param tabs - Existing tabs
 * @param id - Tab to close
 * @param fallbackText - Buffer when the last tab is closed
 */
export function closeQueryTab(
  tabs: readonly QueryTab[],
  id: string,
  fallbackText: string,
): readonly QueryTab[] {
  const next = tabs.filter((t) => t.id !== id);
  if (next.length > 0) return next;
  return [{ id: newTabId(), title: "Query 1", text: fallbackText }];
}

/**
 * Replace one tab's buffer.
 *
 * @param tabs - Existing tabs
 * @param id - Tab id
 * @param text - Next buffer
 */
export function writeQueryTab(
  tabs: readonly QueryTab[],
  id: string,
  text: string,
): readonly QueryTab[] {
  return tabs.map((t) => (t.id === id ? { ...t, text } : t));
}

/**
 * Rename one tab. Empty titles fall back to the next unused `Query N`.
 *
 * @param tabs - Existing tabs
 * @param id - Tab id
 * @param title - Next title
 */
export function renameQueryTab(
  tabs: readonly QueryTab[],
  id: string,
  title: string,
): readonly QueryTab[] {
  const trimmed = title.trim().replace(/\s+/g, " ");
  const nextTitle = trimmed.length > 0 ? trimmed.slice(0, 48) : nextQueryTitle(tabs.filter((t) => t.id !== id));
  return tabs.map((t) => (t.id === id ? { ...t, title: nextTitle } : t));
}

/** One named query kept across sessions. */
export type SavedQuery = {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly at: number;
};

/**
 * Upsert a saved query (same id replaces) and cap the list.
 *
 * @param entries - Existing saved
 * @param entry - Tab snapshot
 */
export function upsertSavedQuery(
  entries: readonly SavedQuery[],
  entry: Omit<SavedQuery, "at"> & { readonly at?: number },
): readonly SavedQuery[] {
  const next: SavedQuery = {
    id: entry.id,
    title: entry.title,
    text: entry.text,
    at: entry.at ?? Date.now(),
  };
  return [next, ...entries.filter((row) => row.id !== next.id)].slice(0, SAVED_CAP);
}

/**
 * Prepend a history row and cap the list.
 *
 * @param entries - Existing history
 * @param entry - New run (id assigned here)
 */
export function pushQueryHistory(
  entries: readonly QueryHistoryEntry[],
  entry: Omit<QueryHistoryEntry, "id">,
): readonly QueryHistoryEntry[] {
  return [{ ...entry, id: newTabId() }, ...entries].slice(0, HISTORY_CAP);
}

/**
 * First line of a history preview (comments skipped for KV).
 *
 * @param text - Buffer
 */
export function historyPreview(text: string): string {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("//") || trimmed.startsWith("--")) continue;
    return trimmed.length > 72 ? `${trimmed.slice(0, 71)}…` : trimmed;
  }
  return text.trim().slice(0, 72) || "(empty)";
}

/**
 * Load tabs for a facet. Missing / corrupt storage returns null.
 *
 * @param facet - SQL or KV
 */
export function loadQueryTabs(facet: StoreQueryFacet): readonly QueryTab[] | null {
  const key = tabKey(facet);
  const local = readJson(localStore(), key, isTabList);
  if (local) return local;
  const session = readJson(sessionStore(), key, isTabList);
  if (session) writeJson(localStore(), key, session);
  return session;
}

/**
 * Persist tabs for a facet.
 *
 * @param facet - SQL or KV
 * @param tabs - Tabs
 */
export function saveQueryTabs(facet: StoreQueryFacet, tabs: readonly QueryTab[]): void {
  writeJson(localStore(), tabKey(facet), tabs);
}

/**
 * Load run history for a facet.
 *
 * @param facet - SQL or KV
 */
export function loadQueryHistory(facet: StoreQueryFacet): readonly QueryHistoryEntry[] {
  return readJson(sessionStore(), historyKey(facet), isHistoryList) ?? [];
}

/**
 * Persist run history for a facet.
 *
 * @param facet - SQL or KV
 * @param entries - History
 */
export function saveQueryHistory(
  facet: StoreQueryFacet,
  entries: readonly QueryHistoryEntry[],
): void {
  writeJson(sessionStore(), historyKey(facet), entries);
}

/**
 * Load named saved queries for a facet.
 *
 * @param facet - SQL or KV
 */
export function loadSavedQueries(facet: StoreQueryFacet): readonly SavedQuery[] {
  return readJson(localStore(), savedKey(facet), isSavedList) ?? [];
}

/**
 * Persist named saved queries.
 *
 * @param facet - SQL or KV
 * @param entries - Saved
 */
export function saveSavedQueries(facet: StoreQueryFacet, entries: readonly SavedQuery[]): void {
  writeJson(localStore(), savedKey(facet), entries);
}

function tabKey(facet: StoreQueryFacet): string {
  return `oke_store_query_tabs_${facet}`;
}

function historyKey(facet: StoreQueryFacet): string {
  return `oke_store_query_history_${facet}`;
}

function savedKey(facet: StoreQueryFacet): string {
  return `oke_store_query_saved_${facet}`;
}

function newTabId(): string {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isTabList(value: unknown): value is QueryTab[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    (row) =>
      row !== null &&
      typeof row === "object" &&
      typeof (row as QueryTab).id === "string" &&
      typeof (row as QueryTab).title === "string" &&
      typeof (row as QueryTab).text === "string",
  );
}

function isHistoryList(value: unknown): value is QueryHistoryEntry[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (row) =>
      row !== null &&
      typeof row === "object" &&
      typeof (row as QueryHistoryEntry).id === "string" &&
      typeof (row as QueryHistoryEntry).at === "number" &&
      typeof (row as QueryHistoryEntry).text === "string",
  );
}

function isSavedList(value: unknown): value is SavedQuery[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (row) =>
      row !== null &&
      typeof row === "object" &&
      typeof (row as SavedQuery).id === "string" &&
      typeof (row as SavedQuery).title === "string" &&
      typeof (row as SavedQuery).text === "string" &&
      typeof (row as SavedQuery).at === "number",
  );
}

function localStore(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function readJson<T>(
  store: Storage | null,
  key: string,
  guard: (value: unknown) => value is T,
): T | null {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeJson(store: Storage | null, key: string, value: unknown): void {
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // quota / private mode
  }
}
