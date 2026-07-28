/**
 * Shared HTTP request parsing and input assembly for AoT and dynamic paths.
 *
 * Both compilers must call these helpers so responses stay byte-identical.
 */

/** Which request parts a route handler needs. */
export interface ContextInference {
  readonly body: boolean;
  readonly query: boolean;
  readonly params: boolean;
  readonly headers: boolean;
  readonly cookie: boolean;
}

/** Mutable inference accumulator (sucrose merges with OR). */
export type MutableInference = {
  -readonly [K in keyof ContextInference]: boolean;
};

/** Parts extracted from a request before contract validation. */
export interface InputParts {
  readonly params?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly cookie?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

/** All context slots enabled — used by the dynamic fallback. */
export const FULL_INFERENCE: ContextInference = {
  body: true,
  query: true,
  params: true,
  headers: true,
  cookie: true,
};

/** Empty inference seed. */
export function emptyInference(): MutableInference {
  return {
    body: false,
    query: false,
    params: false,
    headers: false,
    cookie: false,
  };
}

/**
 * Merge inference flags with logical OR.
 *
 * @param into - Accumulator
 * @param next - Flags to merge
 */
export function mergeInference(into: MutableInference, next: ContextInference): MutableInference {
  into.body = into.body || next.body;
  into.query = into.query || next.query;
  into.params = into.params || next.params;
  into.headers = into.headers || next.headers;
  into.cookie = into.cookie || next.cookie;
  return into;
}

/**
 * Extract `:param` names from an HTTP path pattern.
 *
 * @param path - Route path (e.g. `/notes/:id`)
 */
export function pathParamNames(path: string): string[] {
  const names: string[] = [];
  for (const segment of path.split("/")) {
    if (segment.startsWith(":") && segment.length > 1) {
      names.push(segment.slice(1));
    }
  }
  return names;
}

/**
 * Parse JSON / text body. Empty body → `undefined`.
 *
 * @param request - Incoming request
 */
export async function parseBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Parse the query string into a flat string map.
 *
 * @param request - Incoming request
 */
export function parseQuery(request: Request): Record<string, string> {
  const url = new URL(request.url);
  const out: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    out[key] = value;
  }
  return out;
}

/**
 * Lower-cased header map (first value wins).
 *
 * @param request - Incoming request
 */
export function parseHeaders(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/**
 * Parse `Cookie` header into a name → value map.
 *
 * @param request - Incoming request
 */
export function parseCookie(request: Request): Record<string, string> {
  const raw = request.headers.get("cookie");
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Assemble handler input from extracted parts.
 *
 * Order: params → query → body fields (object merge) → headers/cookie bags.
 * Matches the historical `oke().fetch` merge so AoT and dynamic agree.
 *
 * @param parts - Extracted request parts
 */
export function assembleInput(parts: InputParts): unknown {
  const out: Record<string, unknown> = {};

  if (parts.params !== undefined) {
    Object.assign(out, parts.params);
  }
  if (parts.query !== undefined) {
    Object.assign(out, parts.query);
  }

  if (parts.body !== undefined) {
    if (typeof parts.body === "object" && parts.body !== null && !Array.isArray(parts.body)) {
      Object.assign(out, parts.body as Record<string, unknown>);
    } else {
      out.body = parts.body;
    }
  }

  if (parts.headers !== undefined) {
    out.headers = parts.headers;
  }
  if (parts.cookie !== undefined) {
    out.cookie = parts.cookie;
  }

  if (Object.keys(out).length === 0) {
    return parts.body !== undefined ? parts.body : undefined;
  }
  return out;
}

/**
 * Extract request parts according to inference flags.
 *
 * @param request - Incoming request
 * @param params - Router path params
 * @param inference - Which slots to populate
 */
export async function extractParts(
  request: Request,
  params: Readonly<Record<string, string>>,
  inference: ContextInference,
): Promise<InputParts> {
  const parts: {
    params?: Record<string, string>;
    query?: Record<string, string>;
    headers?: Record<string, string>;
    cookie?: Record<string, string>;
    body?: unknown;
  } = {};

  if (inference.params) parts.params = { ...params };
  if (inference.query) parts.query = parseQuery(request);
  if (inference.headers) parts.headers = parseHeaders(request);
  if (inference.cookie) parts.cookie = parseCookie(request);
  if (inference.body) parts.body = await parseBody(request);

  return parts;
}
