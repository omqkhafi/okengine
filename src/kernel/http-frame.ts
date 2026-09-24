/**
 * HTTP wire frame stored on a wide event — query, headers, status.
 *
 * Credential headers are replaced before the row is written. The body stays
 * on `input` / `output`; this frame is the rest of the message.
 */

import type { RunHttpFrame } from "../runs/types.ts";

/** Replacement for credential header and query values. */
export const HTTP_FRAME_REDACTED = "[redacted]";

const EXACT_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "dpop",
]);

/**
 * Build the Request a Console invoke would have sent for an HTTP flow.
 *
 * Call API runs `execute` directly, so there is no socket request. The frame
 * still needs a method, path, query, and the headers the invoke actually
 * uses (`accept`, `x-oke-client: console`, and `content-type` when there is a body).
 * The operator's browser user-agent is not copied onto the flow.
 *
 * @param trigger - HTTP method and path template
 * @param options - Path params and the assembled flow input
 */
export function requestForHttpInvoke(
  trigger: { readonly method: string; readonly path: string },
  options: {
    readonly pathParams?: Readonly<Record<string, string>>;
    readonly input?: unknown;
  } = {},
): Request {
  let path = trigger.path;
  const params = options.pathParams ?? {};
  for (const [key, value] of Object.entries(params)) {
    path = path.replaceAll(`:${key}`, encodeURIComponent(value));
  }
  const url = new URL(path, "http://127.0.0.1");
  const method = trigger.method.toUpperCase();
  const headers = new Headers({ accept: "application/json", "x-oke-client": "console" });
  if (!methodCarriesBody(method)) {
    appendScalarQuery(url, options.input, new Set(Object.keys(params)));
    return new Request(url.href, { method, headers });
  }
  headers.set("content-type", "application/json");
  const body = options.input === undefined ? undefined : JSON.stringify(options.input);
  return new Request(url.href, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
  });
}

/**
 * Build the wire frame for an HTTP run.
 *
 * Does not read the body. Safe to call after the handler has consumed it,
 * including streamed responses.
 *
 * @param request - Incoming request
 * @param response - Final response after `onResponse`, when one exists
 */
export function captureHttpFrame(request: Request, response: Response | undefined): RunHttpFrame {
  const url = new URL(request.url);
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    query[key] = sensitiveQuery(key) ? HTTP_FRAME_REDACTED : value;
  }
  return redactHttpFrame({
    request: {
      method: request.method,
      path: url.pathname,
      query,
      headers: headerMap(request.headers),
    },
    ...(response !== undefined
      ? { response: { status: response.status, headers: headerMap(response.headers) } }
      : {}),
  });
}

/**
 * Mask credential headers and query values on a stored frame.
 *
 * Applied again at Console projection so a row that skipped capture still
 * does not show secrets.
 *
 * @param frame - Stored HTTP frame
 */
export function redactHttpFrame(frame: RunHttpFrame): RunHttpFrame {
  return {
    request: {
      method: frame.request.method,
      path: frame.request.path,
      query: redactQuery(frame.request.query),
      headers: redactHeaders(frame.request.headers),
    },
    ...(frame.response !== undefined
      ? {
          response: {
            status: frame.response.status,
            headers: redactHeaders(frame.response.headers),
          },
        }
      : {}),
  };
}

/**
 * True when a header name carries a credential.
 *
 * @param name - Lower-case header name
 */
export function sensitiveHeader(name: string): boolean {
  const key = name.toLowerCase();
  if (EXACT_HEADERS.has(key)) return true;
  if (key === "idempotency-key") return false;
  return (
    key.includes("token") ||
    key.includes("secret") ||
    key.includes("api-key") ||
    key.endsWith("-key") ||
    key.endsWith("_key")
  );
}

function methodCarriesBody(method: string): boolean {
  switch (method) {
    case "GET":
    case "HEAD":
    case "DELETE":
      return false;
    default:
      return true;
  }
}

function appendScalarQuery(url: URL, input: unknown, skip: ReadonlySet<string>): void {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (skip.has(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      url.searchParams.set(key, String(value));
    }
  }
}

function sensitiveQuery(name: string): boolean {
  const key = name.toLowerCase();
  return (
    key === "token" ||
    key.endsWith("_token") ||
    key.endsWith("-token") ||
    key === "api_key" ||
    key === "apikey" ||
    key === "api-key" ||
    key === "secret" ||
    key === "password" ||
    key === "access_token" ||
    key === "refresh_token"
  );
}

function headerMap(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (sensitiveHeader(name)) {
      out[name] = HTTP_FRAME_REDACTED;
      return;
    }
    const prev = out[name];
    out[name] = prev === undefined ? value : `${prev}, ${value}`;
  });
  return sortRecord(out);
}

function redactHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = sensitiveHeader(key) ? HTTP_FRAME_REDACTED : value;
  }
  return sortRecord(out);
}

function redactQuery(query: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    out[key] = sensitiveQuery(key) ? HTTP_FRAME_REDACTED : value;
  }
  return sortRecord(out);
}

function sortRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}
