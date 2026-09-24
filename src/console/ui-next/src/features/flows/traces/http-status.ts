/**
 * Status accent for the trace Response frame.
 */

const STATUS_REASON: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  301: "Moved",
  302: "Found",
  304: "Not Modified",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  415: "Unsupported Media Type",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

/**
 * Short reason phrase for a status code, when we know one.
 *
 * @param status - HTTP status
 */
export function httpStatusReason(status: number): string | null {
  return STATUS_REASON[status] ?? null;
}

/**
 * Text color for a status code.
 *
 * @param status - HTTP status
 */
export function httpStatusTextClass(status: number): string {
  if (status >= 500) return "text-destructive";
  if (status >= 400) return "text-amber-700 dark:text-amber-400";
  if (status >= 300) return "text-sky-700 dark:text-sky-400";
  return "text-emerald-700 dark:text-emerald-400";
}

/**
 * Rail fill for a status code.
 *
 * @param status - HTTP status
 */
export function httpStatusRailClass(status: number): string {
  if (status >= 500) return "bg-destructive";
  if (status >= 400) return "bg-amber-500";
  if (status >= 300) return "bg-sky-500";
  return "bg-emerald-500";
}
