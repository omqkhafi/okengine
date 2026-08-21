/**
 * Branded sentinel for `http.get()` with no path — never `"/"`.
 * Lives in a leaf module so `oke()` can refuse leftovers without pulling
 * the HTTP trigger constructors onto a Store-only graph.
 */

/** Unresolved path token. {@link stampHttpPath} replaces it from the file tree. */
export const HTTP_PATH_PENDING = "__oke_http_path_pending__" as const;

/** Type of {@link HTTP_PATH_PENDING}. */
export type HttpPathPending = typeof HTTP_PATH_PENDING;

/**
 * True when an HTTP trigger still carries the unresolved path sentinel.
 *
 * @param path - Trigger path
 */
export function isPendingHttpPath(path: string): boolean {
  return path === HTTP_PATH_PENDING;
}
