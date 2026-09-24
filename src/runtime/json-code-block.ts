/**
 * Browser GET → traces-language JSON page. Clients still get the envelope.
 */

import { HTTP_FRAME_REDACTED, sensitiveHeader } from "../kernel/http-frame.ts";
import { CONSOLE_PORT } from "./types.ts";

/** One highlighted JSON span. */
export type JsonCodeTokenKind = "key" | "string" | "number" | "literal" | "punct" | "space";

/** Highlighted span. */
export interface JsonCodeToken {
  readonly kind: JsonCodeTokenKind;
  readonly text: string;
}

/** Inputs for {@link renderJsonCodeBlockHtml}. */
export interface JsonCodeBlockRenderOptions {
  readonly json: string;
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly app: string;
  readonly rawHref: string;
  readonly prettyHref: string;
  /** Compact one-line JSON (`?raw=1`). Default pretty. */
  readonly compact?: boolean;
  /** Route tree for the right-rail nav (Schema panel language). */
  readonly nav?: readonly JsonCodeNavGroup[];
  /** Handler elapsed time in milliseconds. */
  readonly latencyMs?: number;
  /** Wide-event cache dimension from the invocation. */
  readonly cache?: JsonCodeCache;
  /** Auth principal that handled the request (traces language). */
  readonly auth?: JsonCodeAuth;
  /**
   * Response headers for the Fields view. Credential names are shown as
   * `[redacted]`. Omit `content-length` — the page replaces the body.
   */
  readonly headers?: Readonly<Record<string, string>>;
}

/** Wide-event cache dimension on the browser JSON page. */
export type JsonCodeCache = "hit" | "miss" | "none";

/**
 * Auth mark on the browser JSON page — who handled the request.
 *
 * `public` is the intentional unauthenticated sentinel (`.public()` /
 * `gate.public`). `none` means no credentials and no public gate.
 */
export type JsonCodeAuthKind = "none" | "public" | "user" | "key" | "operator";

/** Auth principal projection for {@link renderJsonCodeBlockHtml}. */
export interface JsonCodeAuth {
  readonly kind: JsonCodeAuthKind;
  /** Subject id when known (user / key / operator). */
  readonly id?: string | null;
}

/**
 * Build the auth mark from the resolved principal + optional public gate.
 *
 * @param input - Identity + whether the route is `.public()`
 */
export function jsonCodeAuthFrom(input: {
  readonly userId?: string | null;
  readonly apiKeyId?: string | null;
  readonly operatorId?: string | null;
  readonly publicGate?: boolean;
}): JsonCodeAuth {
  if (input.operatorId) return { kind: "operator", id: input.operatorId };
  if (input.apiKeyId) return { kind: "key", id: input.apiKeyId };
  if (input.userId) return { kind: "user", id: input.userId };
  if (input.publicGate) return { kind: "public" };
  return { kind: "none" };
}
/** One HTTP route under a {@link JsonCodeNavGroup}. */
export interface JsonCodeNavRoute {
  readonly method: string;
  readonly path: string;
  /** Set for static GET — parameterized GET uses Path tab values. */
  readonly href: string | null;
  readonly current: boolean;
  /** `:name` segments from {@link path} (empty when static). */
  readonly paramNames: readonly string[];
}

/**
 * Collect `:param` names from an HTTP path template.
 *
 * @param path - e.g. `/notes/:id/archive`
 */
export function pathParamNames(path: string): string[] {
  const names: string[] = [];
  for (const seg of path.split("/")) {
    if (seg.startsWith(":") && seg.length > 1) names.push(seg.slice(1));
  }
  return names;
}

/**
 * Match a pathname against a `:param` template.
 *
 * @param template - e.g. `/notes/:id`
 * @param pathname - e.g. `/notes/abc`
 */
export function matchPathTemplate(
  template: string,
  pathname: string,
): Record<string, string> | null {
  const tParts = template.split("/");
  const pParts = pathname.split("/");
  if (tParts.length !== pParts.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < tParts.length; i += 1) {
    const t = tParts[i]!;
    const p = pParts[i]!;
    if (t.startsWith(":") && t.length > 1) {
      try {
        out[t.slice(1)] = decodeURIComponent(p);
      } catch {
        out[t.slice(1)] = p;
      }
      continue;
    }
    if (t !== p) return null;
  }
  return out;
}

/**
 * Fill a path template with values. Returns null when any param is empty.
 *
 * @param template - e.g. `/notes/:id`
 * @param values - param name → value
 */
export function fillPathTemplate(
  template: string,
  values: Readonly<Record<string, string>>,
): string | null {
  const parts = template.split("/");
  const out: string[] = [];
  for (const seg of parts) {
    if (seg.startsWith(":") && seg.length > 1) {
      const v = (values[seg.slice(1)] ?? "").trim();
      if (!v) return null;
      out.push(encodeURIComponent(v));
      continue;
    }
    out.push(seg);
  }
  return out.join("/");
}

/** First-segment group in the Routes rail. */
export interface JsonCodeNavGroup {
  readonly name: string;
  readonly routes: readonly JsonCodeNavRoute[];
}

/** Binding-shaped input for {@link httpGetNavPaths} and {@link httpNavGroups}. */
export interface HttpGetNavSource {
  readonly trigger: {
    readonly kind: string;
    readonly method?: string;
    readonly path?: string;
  };
}

const HTML_ESCAPE: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

/**
 * Escape text for an HTML text node or attribute.
 *
 * @param value - Raw text
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => HTML_ESCAPE[ch] ?? ch);
}

/**
 * Pretty-print JSON when the body is valid; otherwise return the raw text.
 *
 * @param raw - Response body
 */
export function prettyJson(raw: string): string {
  return formatJson(raw, false);
}

/**
 * Compact or pretty JSON when the body is valid; otherwise the raw text.
 *
 * @param raw - Response body
 * @param compact - One line when true
 */
export function formatJson(raw: string, compact: boolean): string {
  try {
    return JSON.stringify(JSON.parse(raw) as unknown, null, compact ? undefined : 2);
  } catch {
    return raw;
  }
}

/**
 * Tokenize JSON for the code-block highlighter.
 *
 * @param source - Pretty-printed JSON (or raw text)
 */
export function tokenizeJson(source: string): JsonCodeToken[] {
  const tokens: JsonCodeToken[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      let end = i + 1;
      while (end < source.length) {
        const next = source[end]!;
        if (next !== " " && next !== "\t" && next !== "\n" && next !== "\r") break;
        end += 1;
      }
      tokens.push({ kind: "space", text: source.slice(i, end) });
      i = end;
      continue;
    }
    if (ch === "{" || ch === "}" || ch === "[" || ch === "]" || ch === ":" || ch === ",") {
      tokens.push({ kind: "punct", text: ch });
      i += 1;
      continue;
    }
    if (ch === '"') {
      const end = scanJsonString(source, i);
      tokens.push({ kind: "string", text: source.slice(i, end) });
      i = end;
      continue;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      const end = scanJsonNumber(source, i);
      tokens.push({ kind: "number", text: source.slice(i, end) });
      i = end;
      continue;
    }
    if (source.startsWith("true", i) && !isJsonIdent(source[i + 4])) {
      tokens.push({ kind: "literal", text: "true" });
      i += 4;
      continue;
    }
    if (source.startsWith("false", i) && !isJsonIdent(source[i + 5])) {
      tokens.push({ kind: "literal", text: "false" });
      i += 5;
      continue;
    }
    if (source.startsWith("null", i) && !isJsonIdent(source[i + 4])) {
      tokens.push({ kind: "literal", text: "null" });
      i += 4;
      continue;
    }
    tokens.push({ kind: "space", text: ch });
    i += 1;
  }
  return markJsonKeys(tokens);
}

/**
 * Best q-value for `type/subtype` in an Accept header (star ranges count).
 *
 * @param accept - Raw Accept header
 * @param type - Type (`text`, `application`)
 * @param subtype - Subtype (`html`, `json`)
 */
export function acceptQuality(accept: string, type: string, subtype: string): number {
  let best = 0;
  let found = false;
  for (const part of accept.split(",")) {
    const [rangeRaw, ...params] = part.split(";").map((s) => s.trim());
    const range = rangeRaw?.toLowerCase();
    if (!range) continue;
    let q = 1;
    for (const param of params) {
      const eq = param.indexOf("=");
      if (eq === -1) continue;
      if (param.slice(0, eq).trim().toLowerCase() !== "q") continue;
      const parsed = Number(param.slice(eq + 1).trim());
      if (Number.isFinite(parsed)) q = parsed;
    }
    if (q < 0) q = 0;
    if (q > 1) q = 1;
    const [rType, rSub] = range.split("/");
    if (!rType || !rSub) continue;
    const exact = rType === type && rSub === subtype;
    const typeStar = rType === type && rSub === "*";
    const star = rType === "*" && rSub === "*";
    if (!exact && !typeStar && !star) continue;
    if (!found || q > best) best = q;
    found = true;
  }
  return found ? best : 0;
}

/**
 * True when `text/html` outranks `application/json` (browsers). Ties stay JSON.
 *
 * @param accept - Raw Accept header
 */
export function prefersHtml(accept: string | null): boolean {
  if (!accept?.trim()) return false;
  return acceptQuality(accept, "text", "html") > acceptQuality(accept, "application", "json");
}

/**
 * Whether this GET JSON response should become the browser code block.
 *
 * @param request - Incoming request
 * @param response - Encoded JSON envelope
 */
export function shouldRenderJsonCodeBlock(request: Request, response: Response): boolean {
  if (request.method.toUpperCase() !== "GET") return false;
  const url = new URL(request.url);
  if (url.pathname === "/_/ready" || url.pathname.startsWith("/_/")) return false;
  if (url.pathname.startsWith("/_oke/")) return false;
  if (url.searchParams.get("format") === "json") return false;
  if (!prefersHtml(request.headers.get("accept"))) return false;
  const ct = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  return ct === "application/json";
}

/**
 * Console URL on the same host as the app request.
 *
 * @param request - Incoming request
 */
export function consoleUrlFromRequest(request: Request): string {
  const url = new URL(request.url);
  const host = url.hostname.includes(":") ? `[${url.hostname}]` : url.hostname;
  return `${url.protocol}//${host}:${CONSOLE_PORT}`;
}

/**
 * `?raw=1` href that keeps other query params.
 *
 * @param request - Incoming request
 */
export function rawHrefFromRequest(request: Request): string {
  const url = new URL(request.url);
  url.searchParams.set("raw", "1");
  return `${url.pathname}${url.search}`;
}

/**
 * Pretty-view href — drops `raw`, keeps other query params.
 *
 * @param request - Incoming request
 */
export function prettyHrefFromRequest(request: Request): string {
  const url = new URL(request.url);
  url.searchParams.delete("raw");
  const search = url.searchParams.toString();
  return search.length > 0 ? `${url.pathname}?${search}` : url.pathname;
}

/**
 * Static GET paths from HTTP bindings — no params, no `/_/` internals.
 *
 * @param bindings - Adopted app bindings
 */
export function httpGetNavPaths(bindings: readonly HttpGetNavSource[]): string[] {
  const paths = new Set<string>();
  for (const binding of bindings) {
    const trigger = binding.trigger;
    if (trigger.kind !== "http" || trigger.method !== "GET") continue;
    const path = trigger.path;
    if (!path || path.includes(":") || path.startsWith("/_/")) continue;
    paths.add(path);
  }
  return [...paths].sort(compareNavPath);
}

/**
 * Group HTTP routes by first path segment for the Routes rail.
 *
 * @param bindings - Adopted app bindings
 * @param request - Incoming request
 */
export function httpNavGroups(
  bindings: readonly HttpGetNavSource[],
  request: Request,
): JsonCodeNavGroup[] {
  const url = new URL(request.url);
  const raw = url.searchParams.has("raw");
  const byGroup = new Map<string, Map<string, JsonCodeNavRoute>>();
  for (const binding of bindings) {
    const trigger = binding.trigger;
    if (trigger.kind !== "http") continue;
    const method = trigger.method;
    const path = trigger.path;
    if (!method || !path || path.startsWith("/_/")) continue;
    const name = navGroupName(path);
    const key = `${method} ${path}`;
    const paramNames = pathParamNames(path);
    const navigable = method === "GET" && paramNames.length === 0;
    const matched = paramNames.length > 0 ? matchPathTemplate(path, url.pathname) : null;
    const group = byGroup.get(name) ?? new Map<string, JsonCodeNavRoute>();
    group.set(key, {
      method,
      path,
      href: navigable ? (raw ? `${path}?raw=1` : path) : null,
      current: method === "GET" && (url.pathname === path || matched !== null),
      paramNames,
    });
    byGroup.set(name, group);
  }
  return [...byGroup.entries()]
    .sort(([a], [b]) => compareNavPath(a === "/" ? "/" : `/${a}`, b === "/" ? "/" : `/${b}`))
    .map(([name, routes]) => ({
      name,
      routes: [...routes.values()].sort((left, right) => {
        const pathCmp = compareNavPath(left.path, right.path);
        return pathCmp !== 0 ? pathCmp : left.method.localeCompare(right.method);
      }),
    }));
}

function navGroupName(path: string): string {
  if (path === "/") return "/";
  return path.split("/").filter((seg) => seg.length > 0)[0] ?? "/";
}

function compareNavPath(a: string, b: string): number {
  if (a === "/") return -1;
  if (b === "/") return 1;
  return a.localeCompare(b);
}

/**
 * Compact latency for the browser JSON page header.
 *
 * @param ms - Elapsed milliseconds
 */
export function formatJsonCodeLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0μs";
  if (ms < 1) return `${Math.round(ms * 1_000)}μs`;
  if (ms < 1_000) {
    const rounded = Math.round(ms * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}ms` : `${rounded.toFixed(1)}ms`;
  }
  const seconds = ms / 1_000;
  const rounded = Math.round(seconds * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}s` : `${rounded.toFixed(1)}s`;
}

/** Traces duration bands — same cutoffs as Console TraceRow. */
export type JsonCodeLatencyTone =
  | "fast"
  | "good"
  | "ok"
  | "elevated"
  | "warn"
  | "slow"
  | "bad"
  | "critical";

const LATENCY_TONE_BOUNDS = [
  { tone: "fast", belowMs: 10 },
  { tone: "good", belowMs: 50 },
  { tone: "ok", belowMs: 100 },
  { tone: "elevated", belowMs: 250 },
  { tone: "warn", belowMs: 500 },
  { tone: "slow", belowMs: 1_000 },
  { tone: "bad", belowMs: 5_000 },
] as const;

/**
 * Cool→hot latency tone — same bands as Console traces.
 *
 * @param ms - Elapsed milliseconds
 */
export function jsonCodeLatencyTone(ms: number): JsonCodeLatencyTone {
  if (!Number.isFinite(ms) || ms < 0) return "fast";
  for (const band of LATENCY_TONE_BOUNDS) {
    if (ms < band.belowMs) return band.tone;
  }
  return "critical";
}

/** Scalar or container kind for one response field. */
type ResponseFieldKind = "string" | "number" | "boolean" | "null" | "object" | "array";

/** One expandable row in the response Fields view. */
interface ResponseFieldRow {
  readonly key: string;
  /** Path from the JSON root, for copy. */
  readonly path: readonly (string | number)[];
  readonly display: string;
  readonly kind: ResponseFieldKind;
  readonly children: readonly ResponseFieldRow[] | null;
}

const PREVIEW_FIELDS = 3;
const PREVIEW_SCALAR_MAX = 42;

const STATUS_REASON: Readonly<Record<number, string>> = {
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

const FIELD_CHEV = `<span class="chev" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 9.5 12 15.5 18 9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
const FIELD_COPY = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M5 16V5.5A1.5 1.5 0 0 1 6.5 4H16" stroke="currentColor" stroke-width="1.5"/></svg>`;

/**
 * Project a JSON value into field rows. Scalars and empty containers return null.
 *
 * @param value - Parsed response body or header map
 * @param path - Path from the root
 */
function responseFieldRows(
  value: unknown,
  path: readonly (string | number)[] = [],
): readonly ResponseFieldRow[] | null {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.map((item, index) => projectResponseField(String(index), item, [...path, index]));
  }
  if (value === null || typeof value !== "object") return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return null;
  return entries.map(([key, item]) => projectResponseField(key, item, [...path, key]));
}

/**
 * Short shape label for a body or container (`2 fields`, `5 items`).
 *
 * @param value - Parsed JSON value
 */
function responseShapeHint(value: unknown): string | null {
  if (Array.isArray(value)) {
    return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  }
  if (value !== null && typeof value === "object") {
    const n = Object.keys(value).length;
    return `${n} ${n === 1 ? "field" : "fields"}`;
  }
  return null;
}

/**
 * Compact byte size of the serialized body.
 *
 * @param json - Serialized JSON text
 */
function responseByteLabel(json: string): string {
  const bytes = new TextEncoder().encode(json).length;
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Fields / JSON control for the response header. Same pair as Console traces.
 *
 * @param hasFields - Whether the body can open as rows
 * @param compact - Compact JSON is the code view
 */
function responseViewToggleHtml(hasFields: boolean, compact: boolean): string {
  if (!hasFields) return "";
  const fieldsOn = !compact;
  const token = (view: "fields" | "json", label: string, icon: string, on: boolean) =>
    `<button type="button" class="token${on ? " is-on" : ""}" data-response-view="${view}" aria-pressed="${on ? "true" : "false"}"><span class="tok-ico">${icon}</span>${label}</button>`;
  return `<span class="view-toggle" role="group" aria-label="Response view" data-slot="json-code-view-toggle">${token("fields", "Fields", GLYPH.list, fieldsOn)}${token("json", "JSON", GLYPH.braces, !fieldsOn)}</span>`;
}

/**
 * Status, response headers, and an expandable body — the Console response frame.
 *
 * @param options - Envelope + headers
 * @param rows - Projected body rows
 * @param value - Parsed body
 * @param bodyJson - Highlighted body, shown when the header is on JSON
 */
function responsePaneHtml(
  options: JsonCodeBlockRenderOptions,
  rows: readonly ResponseFieldRow[],
  value: unknown,
  bodyJson: string,
): string {
  const tone = options.status >= 500 ? "err" : options.status >= 400 ? "warn" : "ok";
  const reason = STATUS_REASON[options.status] ?? "";
  const hint = [responseShapeHint(value), responseByteLabel(options.json)].filter(Boolean).join(" · ");
  const headers = jsonCodeResponseHeaders(options.headers);
  const headerRows = responseFieldRows(headers);
  const headerBlock =
    headerRows && headerRows.length > 0
      ? `<details class="resp-block" open><summary class="resp-label">${FIELD_CHEV}<span>Headers</span><span class="resp-hint">${headerRows.length} ${headerRows.length === 1 ? "field" : "fields"}</span></summary><ul class="fields" data-slot="json-code-response-headers">${fieldListHtml(headerRows)}</ul></details>`
      : "";
  return `<div class="resp" data-slot="json-code-response"><div class="resp-frame"><div class="resp-rail resp-${tone}" data-slot="json-code-response-rail"></div><div class="resp-main"><div class="resp-status" data-slot="json-code-response-status"><span class="resp-code ${tone}">${options.status}</span>${reason ? `<span class="resp-reason">${escapeHtml(reason)}</span>` : ""}</div>${headerBlock}<div class="resp-body" data-slot="json-code-response-body"><div class="resp-label"><span>Body</span>${hint ? `<span class="resp-hint">${escapeHtml(hint)}</span>` : ""}</div><ul class="fields" data-slot="json-code-fields">${fieldListHtml(rows)}</ul><pre>${bodyJson}</pre></div></div></div></div>`;
}

/**
 * Redacted response headers for the Fields view.
 *
 * @param headers - Outgoing response headers, before the page replaces the body
 */
export function jsonCodeResponseHeaders(
  headers: Headers | Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  const write = (key: string, value: string): void => {
    const name = key.toLowerCase();
    if (name === "content-length") return;
    out[name] = sensitiveHeader(name) ? HTTP_FRAME_REDACTED : value;
  };
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      write(key, value);
    });
    return out;
  }
  if (headers) {
    for (const [key, value] of Object.entries(headers)) write(key, value);
  }
  return out;
}

function projectResponseField(
  key: string,
  value: unknown,
  path: readonly (string | number)[],
): ResponseFieldRow {
  return {
    key,
    path,
    display: formatResponseField(value),
    kind: responseFieldKind(value),
    children: responseFieldRows(value, path),
  };
}

function responseFieldKind(value: unknown): ResponseFieldKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    default:
      return "string";
  }
}

function formatResponseField(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  }
  if (typeof value === "object") return objectPreview(value as Record<string, unknown>);
  return typeof value;
}

/** Up to three short scalar fields, otherwise a count. */
function objectPreview(value: Record<string, unknown>): string {
  const keys = Object.keys(value);
  if (keys.length === 0) return "{}";
  const bits: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (bits.length >= PREVIEW_FIELDS) break;
    if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") continue;
    const text = typeof item === "string" ? item : String(item);
    if (text.length === 0 || text.length > PREVIEW_SCALAR_MAX) continue;
    bits.push(`${key}: ${text}`);
  }
  if (bits.length > 0) return bits.join(" · ");
  return `${keys.length} ${keys.length === 1 ? "field" : "fields"}`;
}

function fieldListHtml(rows: readonly ResponseFieldRow[]): string {
  return rows.map((row) => fieldRowHtml(row)).join("");
}

function fieldRowHtml(row: ResponseFieldRow): string {
  const depth = Math.max(0, row.path.length - 1);
  const tone =
    row.kind === "string" ? " s" : row.kind === "number" ? " m" : row.kind === "boolean" ? " l" : "";
  const copy = `<button type="button" class="field-copy" data-field-copy="${escapeHtml(JSON.stringify(row.path))}" aria-label="Copy ${escapeHtml(row.key)}">${FIELD_COPY}</button>`;
  const label = `<span class="field-key">${escapeHtml(row.key)}</span><span class="field-val${tone}${row.kind === "null" ? " is-null" : ""}">${escapeHtml(row.display)}</span><span class="field-kind">${row.kind}</span>`;
  if (row.children) {
    return `<li class="field" data-slot="json-code-field" data-kind="${row.kind}"><details><summary class="field-row" style="--depth:${depth}">${FIELD_CHEV}${label}</summary><ul class="field-kids">${fieldListHtml(row.children)}</ul></details>${copy}</li>`;
  }
  return `<li class="field" data-slot="json-code-field" data-kind="${row.kind}"><div class="field-row" style="--depth:${depth}"><span class="chev" aria-hidden="true"></span>${label}</div>${copy}</li>`;
}

function parseJsonValue(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Full-bleed traces-language page for one JSON envelope.
 *
 * @param options - Envelope + chrome
 */
export function renderJsonCodeBlockHtml(options: JsonCodeBlockRenderOptions): string {
  const compact = options.compact === true;
  const parsed = parseJsonValue(options.json);
  const fieldRows = parsed === undefined ? null : responseFieldRows(parsed);
  const hasFields = fieldRows !== null && fieldRows.length > 0;
  const view = compact ? "raw" : hasFields ? "fields" : "pretty";
  const code = formatJson(options.json, compact);
  const tokens = tokenizeJson(code);
  const lines = splitTokenLines(tokens);
  const title = `${options.method} ${options.path}`;
  const ok = options.status >= 200 && options.status < 300;
  const rows = lines
    .map((line, index) => {
      const n = index + 1;
      const inner = line.length === 0 ? " " : line.map(tokenHtml).join("");
      return `<span class="ln"><span class="n">${n}</span><span class="c${compact ? " wrap" : ""}">${inner}</span></span>`;
    })
    .join("");
  const responseHtml =
    hasFields && fieldRows ? responsePaneHtml(options, fieldRows, parsed, rows) : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(title)} · ${escapeHtml(options.app)}</title>
<style>
:root {
  --field: oklch(0.141 0.005 285.823);
  --ink: oklch(0.985 0 0);
  --mute: oklch(0.705 0.015 286.067);
  --line: oklch(1 0 0 / 0.06);
  --hover: oklch(0.25 0.006 286.033 / 0.5);
  --ready: oklch(0.75 0.14 163);
  --fail: oklch(0.7 0.19 22);
  --key: oklch(0.78 0.1 230);
  --str: oklch(0.82 0.05 55);
  --num: oklch(0.8 0.04 80);
  --lit: oklch(0.78 0.09 250);
  --punct: oklch(0.78 0 0);
}
@media (prefers-color-scheme: light) {
  :root {
    --field: oklch(1 0 0);
    --ink: oklch(0.141 0.005 285.823);
    --mute: oklch(0.552 0.016 285.938);
    --line: oklch(0.141 0.005 285.823 / 0.12);
    --hover: oklch(0.967 0.001 286.375 / 0.7);
    --ready: oklch(0.55 0.14 163);
    --fail: oklch(0.58 0.22 25);
    --key: oklch(0.5 0.12 230);
    --str: oklch(0.5 0.1 45);
    --num: oklch(0.48 0.08 80);
    --lit: oklch(0.45 0.14 250);
    --punct: oklch(0.35 0 0);
  }
  .lat-fast { color: oklch(0.696 0.17 162.48); }
  .lat-good { color: oklch(0.596 0.145 163.225); }
  .lat-ok { color: oklch(0.648 0.2 131.684); }
  .lat-elevated { color: oklch(0.681 0.162 75.834); }
  .lat-warn { color: oklch(0.666 0.179 58.318); }
  .lat-slow { color: oklch(0.646 0.222 41.116); }
  .lat-critical { color: oklch(0.514 0.222 16.935); }
  .cache-hit { color: oklch(0.685 0.169 237.323); }
  .cache-miss { color: oklch(0.666 0.179 58.318); }
  .auth-user, .auth-key, .auth-operator { color: oklch(0.685 0.169 237.323); }
  .st-ok, .meth-get, .meth-query, .icon.meth-get, .icon.meth-query { color: oklch(0.55 0.14 163); }
  .st-info, .meth-post, .icon.meth-post { color: oklch(0.5 0.12 230); }
  .st-warn, .meth-put, .icon.meth-put { color: oklch(0.55 0.14 75); }
  .meth-patch, .icon.meth-patch { color: oklch(0.48 0.16 300); }
  .st-err, .meth-delete, .icon.meth-delete { color: oklch(0.55 0.2 22); }
  .rail-acc[data-rail-section="query"] { --sec: oklch(0.5 0.12 230); }
  .rail-acc[data-rail-section="body"] { --sec: oklch(0.55 0.14 75); }
  .rail-acc[data-rail-section="cookies"] { --sec: oklch(0.55 0.14 55); }
  .rail-acc[data-rail-section="headers"] { --sec: oklch(0.48 0.16 300); }
  .rail-acc[data-rail-section="auth"] { --sec: oklch(0.48 0.12 175); }
  .rail-acc[data-rail-section="path"] { --sec: oklch(0.48 0.12 250); }
  .token[data-slot="json-code-global-auth"] .tok-ico { color: oklch(0.48 0.12 175); }
  .token[data-slot="json-code-global-headers"] .tok-ico { color: oklch(0.48 0.16 300); }
  .view-toggle .token.is-on[data-response-view="fields"] .tok-ico { color: oklch(0.5 0.12 230); }
  .view-toggle .token.is-on[data-response-view="json"] .tok-ico { color: oklch(0.55 0.14 75); }
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  height: 100svh;
  max-height: 100svh;
  overflow: hidden;
  background: var(--field);
  color: var(--ink);
}
body {
  display: flex;
  flex-direction: column;
  font: 13px/1.45 ui-sans-serif, system-ui, sans-serif;
}
.page { display: flex; flex-direction: column; height: 100%; position: relative; }
.strip {
  display: flex;
  align-items: stretch;
  height: 2.5rem;
  flex-shrink: 0;
  border-bottom: 1px solid var(--line);
}
.title {
  display: inline-flex;
  align-items: center;
  padding: 0 .5rem;
  font-size: .875rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.count {
  display: inline-flex;
  align-items: center;
  gap: .3rem;
  padding: 0 .5rem;
  font-size: 10px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--mute);
}
.lat-fast { color: oklch(0.765 0.177 163.223); }
.lat-good { color: oklch(0.845 0.143 164.978); }
.lat-ok { color: oklch(0.841 0.238 128.85); }
.lat-elevated { color: oklch(0.852 0.199 91.936); }
.lat-warn { color: oklch(0.828 0.189 84.429); }
.lat-slow { color: oklch(0.75 0.183 55.934); }
.lat-bad { color: var(--fail); }
.lat-critical { color: oklch(0.712 0.194 13.428); }
.cache { gap: .25rem; }
.cache-hit { color: oklch(0.746 0.16 232.661); }
.cache-miss { color: oklch(0.828 0.189 84.429); }
.cache-none { color: color-mix(in oklab, var(--mute) 40%, transparent); }
.auth { gap: .25rem; max-width: 9rem; }
.auth-user, .auth-key, .auth-operator { color: oklch(0.746 0.16 232.661); }
.auth-public { color: var(--mute); }
.auth-none { color: color-mix(in oklab, var(--mute) 40%, transparent); }
.st-ok { color: var(--ready); }
.st-info { color: oklch(0.746 0.16 232.661); }
.st-warn { color: oklch(0.828 0.189 84.429); }
.st-err { color: var(--fail); }
.meth-get, .meth-query { color: var(--ready); }
.meth-post { color: oklch(0.746 0.16 232.661); }
.meth-put { color: oklch(0.828 0.189 84.429); }
.meth-patch { color: oklch(0.78 0.14 300); }
.meth-delete { color: var(--fail); }
.meth-head, .meth-options, .meth-other { color: var(--mute); }
.verb { font-weight: 600; }
.file-path { color: var(--ink); }
.kind { color: var(--str); }
.tok-ico, .sec-ico {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.rail-acc[data-rail-section="query"] { --sec: oklch(0.746 0.16 232.661); }
.rail-acc[data-rail-section="body"] { --sec: oklch(0.828 0.189 84.429); }
.rail-acc[data-rail-section="cookies"] { --sec: oklch(0.75 0.16 55); }
.rail-acc[data-rail-section="headers"] { --sec: oklch(0.78 0.13 300); }
.rail-acc[data-rail-section="auth"] { --sec: oklch(0.765 0.15 175); }
.rail-acc[data-rail-section="path"] { --sec: oklch(0.78 0.09 250); }
.sec-ico { color: var(--sec, var(--mute)); }
.token[data-slot="json-code-global-auth"] .tok-ico { color: oklch(0.765 0.15 175); }
.token[data-slot="json-code-global-headers"] .tok-ico { color: oklch(0.78 0.13 300); }
.view-toggle .token.is-on[data-response-view="fields"] .tok-ico { color: oklch(0.746 0.16 232.661); }
.view-toggle .token.is-on[data-response-view="json"] .tok-ico { color: oklch(0.828 0.189 84.429); }
.auth-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 6.5rem;
}
.grow { flex: 1; min-width: 0; }
.token {
  display: inline-flex;
  align-items: center;
  padding: 0 .5rem;
  font-size: 10px;
  font-weight: 500;
  gap: .3rem;
  letter-spacing: .08em;
  text-transform: uppercase;
  text-decoration: none;
  color: var(--mute);
  appearance: none;
  border: 0;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  height: 100%;
}
.token:hover { background: var(--hover); color: var(--ink); }
.token.is-on { color: var(--ink); }
.token[aria-expanded="true"] { color: var(--ink); }
.rail-acc .token.is-on { color: var(--sec, var(--ink)); }
.rail-acc[open] > .rail-acc-sum .sec-ico { color: var(--sec); }
.sep {
  width: 1px;
  align-self: stretch;
  flex-shrink: 0;
  background: var(--line);
}
.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  color: var(--mute);
}
.icon.meth-get, .icon.meth-query { color: var(--ready); }
.icon.meth-post { color: oklch(0.746 0.16 232.661); }
.icon.meth-put { color: oklch(0.828 0.189 84.429); }
.icon.meth-patch { color: oklch(0.78 0.14 300); }
.icon.meth-delete { color: var(--fail); }
.file {
  display: inline-flex;
  align-items: center;
  gap: .4rem;
  min-width: 0;
  padding-right: .5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.head {
  display: inline-flex;
  align-items: center;
  padding: 0 .5rem;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--mute);
}
.state {
  display: inline-flex;
  align-items: center;
  margin-left: auto;
  padding: 0 .5rem;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: ${ok ? "var(--ready)" : "var(--fail)"};
}
.copy {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--mute);
  min-width: 2rem;
  height: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  cursor: pointer;
}
.copy:hover { background: var(--hover); color: var(--ink); }
.copy:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; }
svg[hidden] { display: none !important; }
.body { display: flex; flex: 1; min-height: 0; }
.view { flex: 1; min-width: 0; min-height: 0; overflow: auto; }
.page[data-view="fields"] .resp-body > pre { display: none; }
.page:not([data-view="fields"]) .resp-body > .fields { display: none; }
.view-toggle { display: inline-flex; align-items: stretch; height: 100%; }
.resp { min-height: 100%; }
.resp-frame { display: flex; min-height: 100%; }
.resp-rail { width: 2px; flex-shrink: 0; }
.resp-rail.ok { background: var(--ready); }
.resp-rail.warn { background: oklch(0.8 0.12 80); }
.resp-rail.err { background: var(--fail); }
.resp-main { flex: 1; min-width: 0; }
.resp-status { display: flex; align-items: baseline; gap: .5rem; padding: .5rem .625rem; }
.resp-code { font: 600 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
.resp-code.ok { color: var(--ready); }
.resp-code.warn { color: oklch(0.8 0.12 80); }
.resp-code.err { color: var(--fail); }
.resp-reason { font: 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink); }
.resp-label {
  display: flex;
  align-items: center;
  gap: .375rem;
  min-height: 2rem;
  padding: 0 .5rem;
  border-top: 1px solid var(--line);
  font: 600 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--mute);
  cursor: pointer;
}
.resp-label::-webkit-details-marker { display: none; }
.resp-hint {
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: color-mix(in oklab, var(--mute) 80%, transparent);
}
.resp-block { border: 0; }
.fields, .field-kids { margin: 0; padding: 0; list-style: none; }
.field { position: relative; border-bottom: 1px solid var(--line); }
.field-row {
  display: flex;
  align-items: flex-start;
  gap: .5rem;
  padding: .375rem 2rem .375rem calc(.625rem + var(--depth, 0) * .875rem);
}
.field-row:hover { background: var(--hover); }
summary.field-row { cursor: pointer; }
summary.field-row::-webkit-details-marker { display: none; }
details:not([open]) > summary .chev { transform: rotate(-90deg); }
.field-key {
  width: 7.5rem;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font: 500 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--key);
}
.field-val {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--ink);
}
.field-val.is-null { color: var(--mute); font-style: italic; }
.field-kind {
  flex-shrink: 0;
  margin-top: .15rem;
  font: 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--mute) 70%, transparent);
}
.field-copy {
  position: absolute;
  top: .15rem;
  right: .15rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--mute);
  cursor: pointer;
  opacity: 0;
}
.field:hover > .field-copy, .field:focus-within > .field-copy { opacity: 1; }
.field-copy:hover { color: var(--ink); }
.rail-check { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.rail {
  display: flex;
  width: 22rem;
  flex-shrink: 0;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid var(--line);
}
.rail-toolbar {
  justify-content: space-between;
  padding: 0 .25rem 0 .5rem;
  flex-shrink: 0;
}
.rail-toolbar .head {
  padding: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.rail-nav {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  max-height: 45%;
  min-height: 0;
  overflow: auto;
  border-top: 1px solid var(--line);
}
.routes-check { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.rail-sec-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 2.5rem;
  margin: 0;
  padding: 0 .25rem 0 .5rem;
  flex-shrink: 0;
  border-bottom: 1px solid var(--line);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--mute);
}
.routes-check:not(:checked) ~ .rail-list { display: none; }
.routes-check:not(:checked) ~ .rail-sec-label { border-bottom: 0; }
.routes-check:checked ~ .rail-sec-label .routes-expand { display: none; }
.routes-check:not(:checked) ~ .rail-sec-label .routes-collapse { display: none; }
.rail-dock {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.rail-dock-strip {
  justify-content: flex-start;
  gap: 0;
  border-bottom: 1px solid var(--line);
}
.rail-dock-strip .head {
  gap: .375rem;
  color: var(--ink);
}
.rail-dock-strip .head svg { color: var(--mute); }
.rail-dock-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}
.dock-send {
  appearance: none;
  border: 0;
  margin: 0;
  height: 100%;
  padding: 0 .75rem;
  display: inline-flex;
  align-items: center;
  gap: .375rem;
  font: 600 10px/1 ui-sans-serif, system-ui, sans-serif;
  letter-spacing: .08em;
  text-transform: uppercase;
  background: color-mix(in oklab, var(--mute) 18%, transparent);
  color: var(--ink);
  cursor: pointer;
  flex-shrink: 0;
}
.dock-send:hover { background: var(--hover); }
.dock-send:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; }
.dock-send:disabled {
  opacity: 0.4;
  cursor: default;
}
.rail-acc {
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.rail-acc[hidden] { display: none; }
.rail-acc-sum {
  display: flex;
  align-items: center;
  gap: .25rem;
  height: 2.5rem;
  padding: 0 .5rem 0 .25rem;
  cursor: pointer;
  list-style: none;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--mute);
  user-select: none;
}
.rail-acc-sum::-webkit-details-marker { display: none; }
.rail-acc-sum:hover { background: var(--hover); color: var(--ink); }
.rail-acc[open] > .rail-acc-sum { color: var(--ink); }
.rail-acc-sum .chev {
  display: grid;
  width: 1.5rem;
  height: 1.5rem;
  place-items: center;
  color: var(--mute);
}
.rail-acc:not([open]) > .rail-acc-sum .chev { transform: rotate(-90deg); }
.rail-acc-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.rail-acc-body[hidden] { display: none; }
.kv-editor {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.kv-editor[hidden],
[data-slot="json-code-body-form"][hidden] {
  display: none;
}
.kv-rows {
  min-height: 0;
  max-height: 10rem;
  overflow: auto;
}
.kv-row {
  display: flex;
  align-items: stretch;
  height: 2rem;
  border-bottom: 1px solid var(--line);
}
.kv-key, .kv-val {
  flex: 1;
  min-width: 0;
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--ink);
  font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 0 .5rem;
  outline: none;
}
.kv-key { border-right: 1px solid var(--line); max-width: 42%; }
.kv-key:focus-visible, .kv-val:focus-visible { background: var(--hover); }
.kv-empty {
  margin: 0;
  padding: .75rem .5rem;
  font-size: 11px;
  color: var(--mute);
}
.auth-field {
  display: flex;
  align-items: stretch;
  height: 2rem;
  border-bottom: 1px solid var(--line);
}
.auth-lab {
  display: flex;
  align-items: center;
  width: 42%;
  max-width: 42%;
  flex-shrink: 0;
  padding: 0 .5rem;
  border-right: 1px solid var(--line);
  font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--mute);
}
.auth-field .kv-val { flex: 1; }
.auth-field .kv-val::-ms-reveal { display: none; }
.auth-reveal {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 2.5rem;
  border: 0;
  border-left: 1px solid var(--line);
  background: transparent;
  color: var(--mute);
  cursor: pointer;
}
.auth-reveal:hover { color: var(--ink); background: var(--hover); }
.auth-reveal .eye-shut { display: none; }
.auth-reveal[aria-pressed="true"] .eye-open { display: none; }
.auth-reveal[aria-pressed="true"] .eye-shut { display: block; }
.auth-in {
  display: inline-flex;
  align-items: stretch;
  flex: 1;
  min-width: 0;
}
.auth-pane[hidden] { display: none; }
.global-pop {
  display: flex;
  align-items: stretch;
  height: 2.5rem;
  flex-shrink: 0;
  background: var(--field);
  border-bottom: 1px solid var(--line);
}
.global-pop[hidden] { display: none; }
.global-line {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: stretch;
}
.global-line[hidden] { display: none; }
.global-pop .auth-editor,
.global-pop .auth-pane:not([hidden]) {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: stretch;
}
.global-pop .body-mode-strip { margin: 0; border-right: 1px solid var(--line); }
.global-pop .auth-pane[hidden],
.global-pop .kv-empty[hidden] { display: none; }
.global-pop .auth-field {
  flex: 1;
  height: auto;
  min-width: 8rem;
  border-bottom: 0;
}
.global-pop .auth-lab {
  width: auto;
  max-width: none;
  padding: 0 .75rem;
  color: color-mix(in oklab, var(--mute) 80%, transparent);
}
.global-pop .kv-empty {
  display: flex;
  align-items: center;
  flex: 1;
  margin: 0;
  padding: 0 .75rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.global-pop .kv-editor,
.global-pop .kv-rows {
  display: flex;
  flex: 1;
  min-width: 0;
  max-height: none;
  align-items: stretch;
  overflow-x: auto;
}
.global-pop .kv-row {
  flex: 1 0 18rem;
  height: auto;
  border-bottom: 0;
  border-right: 1px solid var(--line);
}
.global-pop .kv-row:last-child { border-right: 0; }
.body-mode-strip {
  display: inline-flex;
  align-items: stretch;
  align-self: stretch;
  height: 100%;
  flex-shrink: 0;
  margin-inline-end: -.5rem;
}
.body-mode-strip .token {
  height: 100%;
}
.body-json-wrap {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.body-json-wrap[hidden] { display: none; }
.body-json-editor {
  position: relative;
  max-height: 14rem;
  overflow: auto;
  border-bottom: 1px solid var(--line);
}
.body-json-editor:focus-within { background: var(--hover); }
.body-json-editor.is-bad { box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--fail) 55%, transparent); }
.body-json-hi {
  position: absolute;
  inset: 0 auto auto 0;
  width: 100%;
  margin: 0;
  padding: .5rem;
  border: 0;
  font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  color: var(--mute);
  pointer-events: none;
  overflow: hidden;
}
.body-json {
  position: relative;
  z-index: 1;
  display: block;
  appearance: none;
  border: 0;
  margin: 0;
  min-height: 8rem;
  width: 100%;
  resize: vertical;
  background: transparent;
  color: transparent;
  caret-color: var(--ink);
  font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: .5rem;
  outline: none;
  overflow: hidden;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.body-json::placeholder { color: var(--mute); }
.body-json-error {
  margin: 0;
  padding: .375rem .5rem .5rem;
  font-size: 11px;
  color: var(--fail);
  border-top: 1px solid var(--line);
}
.body-json-error[hidden] { display: none; }
.rail-list { margin: 0; padding: 0; overflow: auto; list-style: none; flex: 1; min-height: 0; }
.band {
  display: flex;
  align-items: center;
  gap: .25rem;
  width: 100%;
  padding: .375rem .5rem .375rem .25rem;
  cursor: pointer;
  list-style: none;
}
.band::-webkit-details-marker { display: none; }
.band:hover { background: var(--hover); }
.chev {
  display: grid;
  width: 1.5rem;
  height: 1.5rem;
  place-items: center;
  color: var(--mute);
}
details.rail-acc:not([open]) > .rail-acc-sum .chev,
details:not(.rail-acc):not([open]) .chev { transform: rotate(-90deg); }
.band-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--ink);
}
.cols {
  margin: 0 0 0 .75rem;
  padding: 0;
  list-style: none;
  border-left: 1px solid var(--line);
}
.leaf {
  position: relative;
  display: flex;
  align-items: center;
  gap: .375rem;
  width: 100%;
  padding: .25rem .5rem;
  text-decoration: none;
  color: var(--mute);
  appearance: none;
  border: 0;
  background: transparent;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.leaf:hover { background: var(--hover); color: var(--ink); }
.leaf.is-on { background: oklch(0.25 0.006 286.033 / 0.7); color: var(--ink); }
.leaf.is-on::before {
  content: "";
  position: absolute;
  inset-block: 0;
  left: 0;
  width: 2px;
  background: oklch(0.685 0.148 237);
}
.leaf-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font: 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.leaf-type {
  margin-left: auto;
  flex-shrink: 0;
  font: 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--mute) 70%, transparent);
}
.leaf[data-method="GET"] .leaf-type,
.leaf[data-method="QUERY"] .leaf-type { color: var(--ready); }
.leaf[data-method="POST"] .leaf-type { color: oklch(0.746 0.16 232.661); }
.leaf[data-method="PUT"] .leaf-type { color: oklch(0.828 0.189 84.429); }
.leaf[data-method="PATCH"] .leaf-type { color: oklch(0.78 0.14 300); }
.leaf[data-method="DELETE"] .leaf-type { color: var(--fail); }
.rail-thin {
  display: none;
  width: 1.75rem;
  flex-shrink: 0;
  flex-direction: column;
  align-items: center;
  gap: .5rem;
  padding: .5rem 0;
  border-left: 1px solid var(--line);
  color: var(--mute);
  text-decoration: none;
  cursor: pointer;
}
.rail-thin:hover { background: var(--hover); color: var(--ink); }
.rail-thin span {
  font: 600 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: .08em;
  text-transform: uppercase;
  writing-mode: vertical-rl;
}
.rail-check:not(:checked) ~ .rail { display: none; }
.rail-check:not(:checked) ~ .rail-thin { display: flex; }
@media (prefers-color-scheme: light) {
  .leaf.is-on { background: oklch(0.967 0.001 286.375 / 0.7); }
  .leaf[data-method="GET"] .leaf-type,
  .leaf[data-method="QUERY"] .leaf-type { color: oklch(0.55 0.14 163); }
  .leaf[data-method="POST"] .leaf-type { color: oklch(0.5 0.12 230); }
  .leaf[data-method="PUT"] .leaf-type { color: oklch(0.55 0.14 75); }
  .leaf[data-method="PATCH"] .leaf-type { color: oklch(0.48 0.16 300); }
  .leaf[data-method="DELETE"] .leaf-type { color: oklch(0.55 0.2 22); }
}
pre {
  margin: 0;
  font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.ln {
  display: grid;
  grid-template-columns: 2.75rem minmax(0, 1fr);
  min-height: 1.35rem;
}
.ln:hover { background: var(--hover); }
.n {
  user-select: none;
  padding-right: .75rem;
  text-align: right;
  color: color-mix(in oklab, var(--mute) 70%, transparent);
  font-variant-numeric: tabular-nums;
  border-right: 1px solid var(--line);
}
.c { padding: 0 1rem 0 .5rem; white-space: pre; }
.c.wrap { white-space: pre-wrap; overflow-wrap: anywhere; }
.k { color: var(--key); }
.s { color: var(--str); }
.m { color: var(--num); }
.l { color: var(--lit); }
.p { color: var(--punct); }
</style>
</head>
<body>
  <main class="page" data-slot="json-code-block" data-state="complete" data-view="${view}" data-code-view="${compact ? "raw" : "pretty"}" data-status="${options.status}" data-method="${escapeHtml(options.method)}" data-path="${escapeHtml(options.path)}">
    <header class="strip">
      <span class="title">${escapeHtml(options.app)}</span>
      <span class="count st-${statusTone(options.status)}" data-slot="json-code-status">${GLYPH.dot}${options.status}</span>
      ${latencyHtml(options.latencyMs)}
      ${cacheHtml(options.cache)}
      ${authHtml(options.auth)}
      <span class="grow"></span>
      <button type="button" class="token" data-slot="json-code-global-auth" aria-expanded="false" aria-controls="json-code-global-panel" title="Global authentication"><span class="tok-ico">${GLYPH.key}</span>Auth</button>
      <button type="button" class="token" data-slot="json-code-global-headers" aria-expanded="false" aria-controls="json-code-global-panel" title="Global headers"><span class="tok-ico">${GLYPH.list}</span>Headers</button>
    </header>
    <div class="global-pop" id="json-code-global-panel" data-slot="json-code-global-panel" data-pane="auth" hidden>
      <div class="global-line" data-global-pane="auth" data-auth-scope="global">
        ${authEditorHtml("global")}
      </div>
      <div class="global-line" data-global-pane="headers" hidden>
        <div class="kv-editor">
          <div class="kv-rows" data-slot="json-code-kv-rows" data-kv="headers-global"></div>
        </div>
      </div>
    </div>
    <header class="strip">
      <span class="icon meth meth-${methodTone(options.method)}" data-slot="json-code-method-icon" aria-hidden="true">${methodGlyph(options.method)}</span>
      <span class="file"><span class="verb meth-${methodTone(options.method)}" data-slot="json-code-method">${escapeHtml(options.method)}</span><span class="file-path" data-slot="json-code-path">${escapeHtml(options.path)}</span></span>
      <span class="head kind">json</span>
      <span class="state">${ok ? "Ready" : options.status}</span>
      ${responseViewToggleHtml(hasFields, compact)}
      <button class="copy" type="button" data-slot="json-code-copy" aria-label="Copy code" title="Copy code">
        <svg data-copy width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M5 16V5.5A1.5 1.5 0 0 1 6.5 4H16" stroke="currentColor" stroke-width="1.5"/></svg>
        <svg data-done hidden width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5 9.2 17 19 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </header>
    <div class="body">
      <div class="view">${responseHtml || `<pre>${rows}</pre>`}</div>
      ${navHtml(options.nav)}
    </div>
  </main>
  <textarea id="payload" hidden>${escapeHtml(code)}</textarea>
  <script>
  (() => {
    const METHOD_GLYPH = ${JSON.stringify({
      get: GLYPH.eye,
      query: GLYPH.search,
      post: GLYPH.plus,
      put: GLYPH.pencil,
      patch: GLYPH.pencil,
      delete: GLYPH.trash,
      head: GLYPH.file,
      options: GLYPH.sliders,
      other: GLYPH.file,
    })};
    function methodToneName(method) {
      switch (String(method || "").toUpperCase()) {
        case "GET": return "get";
        case "QUERY": return "query";
        case "POST": return "post";
        case "PUT": return "put";
        case "PATCH": return "patch";
        case "DELETE": return "delete";
        case "HEAD": return "head";
        case "OPTIONS": return "options";
        default: return "other";
      }
    }
    function paintRequestLine(method, path) {
      const tone = methodToneName(method);
      const verb = document.querySelector("[data-slot=json-code-method]");
      const icon = document.querySelector("[data-slot=json-code-method-icon]");
      const pathEl = document.querySelector("[data-slot=json-code-path]");
      if (verb) {
        verb.textContent = method;
        verb.className = "verb meth-" + tone;
      }
      if (icon) {
        icon.className = "icon meth meth-" + tone;
        icon.innerHTML = METHOD_GLYPH[tone] || METHOD_GLYPH.other;
      }
      if (pathEl) pathEl.textContent = path;
    }

    const HEADERS_KEY = "oke:json-code:headers";
    const HEADERS_MODE_KEY = "oke:json-code:headers-mode";
    const HEADERS_GLOBAL_KEY = "oke:json-code:headers-global";
    const AUTH_KEY = "oke:json-code:auth";
    const AUTH_GLOBAL_KEY = "oke:json-code:auth-global";
    const QUERY_KEY = "oke:json-code:query";
    const PATH_KEY = "oke:json-code:path";
    const PATH_TEMPLATE_KEY = "oke:json-code:path-template";
    const METHOD_KEY = "oke:json-code:method";
    const BODY_MODE_KEY = "oke:json-code:body-mode";
    const BODY_FORM_KEY = "oke:json-code:body-form";
    const BODY_JSON_KEY = "oke:json-code:body-json";
    const SECTION_KEY = "oke:json-code:rail-section";
    const ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    const SECTIONS = ["query", "body", "cookies", "headers", "auth", "path"];
    const page = document.querySelector("[data-slot=json-code-block]");
    const railCheck = document.getElementById("json-code-rail");
    const resetBtn = document.querySelector("[data-slot=json-code-reset]");
    const sendBtn = document.querySelector("[data-slot=json-code-send]");
    const bodyFormHost = document.querySelector("[data-slot=json-code-body-form]");
    const bodyJsonHost = document.querySelector("[data-slot=json-code-body-json]");
    const bodyEditor = document.querySelector("[data-slot=json-code-body-editor]");
    const bodyHi = document.querySelector("[data-slot=json-code-body-hi]");
    const bodyRaw = document.querySelector("[data-slot=json-code-body-raw]");
    const bodyError = document.querySelector("[data-slot=json-code-body-error]");
    const bodyModeBtns = document.querySelectorAll("[data-slot=json-code-body-mode]");
    const btn = document.querySelector("[data-slot=json-code-copy]");
    const payload = document.getElementById("payload");
    document.querySelectorAll("[data-response-view]").forEach((el) => {
      el.addEventListener("click", () => {
        const next = el.getAttribute("data-response-view");
        if (!next || !page) return;
        page.setAttribute(
          "data-view",
          next === "fields" ? "fields" : page.getAttribute("data-code-view") || "pretty",
        );
        document.querySelectorAll("[data-response-view]").forEach((other) => {
          const on = other.getAttribute("data-response-view") === next;
          other.classList.toggle("is-on", on);
          other.setAttribute("aria-pressed", on ? "true" : "false");
        });
      });
    });
    document.addEventListener("click", (event) => {
      const copy = event.target instanceof Element ? event.target.closest("[data-field-copy]") : null;
      if (!copy || !payload) return;
      event.preventDefault();
      event.stopPropagation();
      let value;
      try {
        const path = JSON.parse(copy.getAttribute("data-field-copy") || "[]");
        value = JSON.parse(payload.value);
        for (const seg of path) value = value == null ? value : value[seg];
      } catch { return; }
      const text = typeof value === "string" ? value : JSON.stringify(value);
      navigator.clipboard.writeText(text).catch(() => {});
    });
    const copyIcon = btn?.querySelector("[data-copy]");
    const doneIcon = btn?.querySelector("[data-done]");
    if (!page || !sendBtn) return;

    function currentPath() {
      return page.getAttribute("data-path") || location.pathname;
    }

    function rememberMethod(method, path) {
      const m = String(method || "").toUpperCase();
      if (m) sessionStorage.setItem(METHOD_KEY, m);
      if (path) page.setAttribute("data-path", path);
      if (m) page.setAttribute("data-method", m);
    }

    function currentMethod() {
      return (
        sessionStorage.getItem(METHOD_KEY) ||
        page.getAttribute("data-method") ||
        "GET"
      ).toUpperCase();
    }

    function methodAllowsBody(method) {
      switch (String(method || "").toUpperCase()) {
        case "GET":
        case "HEAD":
        case "DELETE":
          return false;
        default:
          return true;
      }
    }

    function bodyMode() {
      const mode = sessionStorage.getItem(BODY_MODE_KEY);
      return mode === "json" ? "json" : "form";
    }

    function setBodyError(message) {
      if (!bodyError || !bodyRaw) return;
      if (!message) {
        bodyError.hidden = true;
        bodyError.textContent = "";
        if (bodyEditor) bodyEditor.classList.remove("is-bad");
        bodyRaw.classList.remove("is-bad");
        return;
      }
      bodyError.hidden = false;
      bodyError.textContent = message;
      if (bodyEditor) bodyEditor.classList.add("is-bad");
      bodyRaw.classList.add("is-bad");
    }

    function isJsonIdentChar(ch) {
      return Boolean(ch) && ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_");
    }

    function scanBodyString(source, start) {
      let i = start + 1;
      while (i < source.length) {
        const ch = source[i];
        if (ch === "\\\\") { i += 2; continue; }
        if (ch === '"') return i + 1;
        i += 1;
      }
      return source.length;
    }

    function scanBodyNumber(source, start) {
      let i = start;
      if (source[i] === "-") i += 1;
      while (i < source.length && source[i] >= "0" && source[i] <= "9") i += 1;
      if (source[i] === ".") {
        i += 1;
        while (i < source.length && source[i] >= "0" && source[i] <= "9") i += 1;
      }
      const exp = source[i];
      if (exp === "e" || exp === "E") {
        i += 1;
        if (source[i] === "+" || source[i] === "-") i += 1;
        while (i < source.length && source[i] >= "0" && source[i] <= "9") i += 1;
      }
      return i;
    }

    function tokenizeBodyJson(source) {
      const tokens = [];
      let i = 0;
      while (i < source.length) {
        const ch = source[i];
        if (ch === " " || ch === "\\t" || ch === "\\n" || ch === "\\r") {
          let end = i + 1;
          while (end < source.length) {
            const next = source[end];
            if (next !== " " && next !== "\\t" && next !== "\\n" && next !== "\\r") break;
            end += 1;
          }
          tokens.push({ kind: "space", text: source.slice(i, end) });
          i = end;
          continue;
        }
        if (ch === "{" || ch === "}" || ch === "[" || ch === "]" || ch === ":" || ch === ",") {
          tokens.push({ kind: "punct", text: ch });
          i += 1;
          continue;
        }
        if (ch === '"') {
          const end = scanBodyString(source, i);
          tokens.push({ kind: "string", text: source.slice(i, end) });
          i = end;
          continue;
        }
        if (ch === "-" || (ch >= "0" && ch <= "9")) {
          const end = scanBodyNumber(source, i);
          tokens.push({ kind: "number", text: source.slice(i, end) });
          i = end;
          continue;
        }
        if (source.startsWith("true", i) && !isJsonIdentChar(source[i + 4])) {
          tokens.push({ kind: "literal", text: "true" });
          i += 4;
          continue;
        }
        if (source.startsWith("false", i) && !isJsonIdentChar(source[i + 5])) {
          tokens.push({ kind: "literal", text: "false" });
          i += 5;
          continue;
        }
        if (source.startsWith("null", i) && !isJsonIdentChar(source[i + 4])) {
          tokens.push({ kind: "literal", text: "null" });
          i += 4;
          continue;
        }
        tokens.push({ kind: "space", text: ch });
        i += 1;
      }
      const out = [];
      for (let t = 0; t < tokens.length; t += 1) {
        const token = tokens[t];
        if (token.kind !== "string") {
          out.push(token);
          continue;
        }
        let j = t + 1;
        while (j < tokens.length && tokens[j].kind === "space") j += 1;
        out.push(
          tokens[j] && tokens[j].kind === "punct" && tokens[j].text === ":"
            ? { kind: "key", text: token.text }
            : token,
        );
      }
      return out;
    }

    function highlightBodyJson(source) {
      if (!source) return "";
      return tokenizeBodyJson(source).map((token) => {
        const text = String(token.text)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        if (token.kind === "key") return '<span class="k">' + text + "</span>";
        if (token.kind === "string") return '<span class="s">' + text + "</span>";
        if (token.kind === "number") return '<span class="m">' + text + "</span>";
        if (token.kind === "literal") return '<span class="l">' + text + "</span>";
        if (token.kind === "punct") return '<span class="p">' + text + "</span>";
        return text;
      }).join("");
    }

    function refreshBodyHighlight(opts) {
      if (!bodyRaw || !bodyHi) return;
      const soft = !opts || opts.soft !== false;
      const text = bodyRaw.value;
      bodyHi.innerHTML = highlightBodyJson(text);
      bodyRaw.style.height = "auto";
      bodyRaw.style.height = Math.max(bodyRaw.scrollHeight, 128) + "px";
      const trim = text.trim();
      if (!trim) {
        setBodyError("");
        return;
      }
      try {
        JSON.parse(trim);
        setBodyError("");
      } catch {
        if (soft) {
          if (bodyEditor) bodyEditor.classList.add("is-bad");
          bodyRaw.classList.add("is-bad");
          if (bodyError) {
            bodyError.hidden = true;
            bodyError.textContent = "";
          }
        } else {
          setBodyError("Body must be valid JSON.");
        }
      }
    }

    function prettyBodyJson() {
      if (!bodyRaw) return;
      const trim = bodyRaw.value.trim();
      if (!trim) return;
      try {
        bodyRaw.value = JSON.stringify(JSON.parse(trim), null, 2);
        sessionStorage.setItem(BODY_JSON_KEY, bodyRaw.value);
        refreshBodyHighlight({ soft: true });
      } catch {
        refreshBodyHighlight({ soft: false });
      }
    }

    function syncBodyMode(mode) {
      const next = mode === "json" ? "json" : "form";
      sessionStorage.setItem(BODY_MODE_KEY, next);
      for (const el of bodyModeBtns) {
        const on = el.getAttribute("data-mode") === next;
        el.classList.toggle("is-on", on);
        el.setAttribute("aria-pressed", on ? "true" : "false");
      }
      if (bodyFormHost) bodyFormHost.hidden = next !== "form";
      if (bodyJsonHost) bodyJsonHost.hidden = next !== "json";
      if (next === "form") {
        setBodyError("");
        renderKv("body");
      } else if (bodyRaw) {
        bodyRaw.value = sessionStorage.getItem(BODY_JSON_KEY) || "";
        refreshBodyHighlight({ soft: true });
      }
    }

    function syncPathChapter() {
      const pathSection = document.querySelector('[data-rail-section="path"]');
      if (!(pathSection instanceof HTMLElement)) return;
      const template = sessionStorage.getItem(PATH_TEMPLATE_KEY) || "";
      const show = pathNames(template).length > 0;
      pathSection.hidden = !show;
      if (!show && pathSection instanceof HTMLDetailsElement) pathSection.open = false;
    }

    function openSection(name) {
      if (!SECTIONS.includes(name)) return;
      sessionStorage.setItem(SECTION_KEY, name);
      if (railCheck) railCheck.checked = true;
      const section = document.querySelector('[data-rail-section="' + name + '"]');
      if (section instanceof HTMLDetailsElement) {
        section.hidden = false;
        section.open = true;
        section.scrollIntoView({ block: "nearest" });
      }
      if (name === "auth") fillAuth("request");
      else if (name === "cookies" || name === "headers" || name === "query" || name === "path" || name === "body") {
        if (name === "body") syncBodyMode(bodyMode());
        else renderKv(name);
      }
    }

    function escAttr(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function loadPairs(key) {
      try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((p) => p && typeof p.key === "string");
      } catch {
        return [];
      }
    }

    function savePairs(key, pairs) {
      sessionStorage.setItem(key, JSON.stringify(pairs));
    }

    function readCookiePairs() {
      const raw = document.cookie || "";
      if (!raw.trim()) return [];
      return raw.split(";").map((part) => {
        const eq = part.indexOf("=");
        if (eq === -1) return { key: part.trim(), value: "" };
        let value = part.slice(eq + 1).trim();
        try { value = decodeURIComponent(value); } catch {}
        return { key: part.slice(0, eq).trim(), value };
      }).filter((p) => p.key);
    }

    function writeCookies(pairs) {
      const existing = new Set(readCookiePairs().map((p) => p.key));
      const next = new Set();
      for (const p of pairs) {
        const k = (p.key || "").trim();
        if (!k) continue;
        next.add(k);
        document.cookie = encodeURIComponent(k) + "=" + encodeURIComponent((p.value || "").trim()) + "; path=/";
      }
      for (const k of existing) {
        if (!next.has(k)) {
          document.cookie = encodeURIComponent(k) + "=; path=/; max-age=0";
        }
      }
    }

    function pathNames(template) {
      return String(template || "").split("/").filter((s) => s.startsWith(":") && s.length > 1).map((s) => s.slice(1));
    }

    function fillPath(template, values) {
      const parts = String(template || "").split("/");
      const out = [];
      for (const seg of parts) {
        if (seg.startsWith(":") && seg.length > 1) {
          const v = (values[seg.slice(1)] ?? "").trim();
          if (!v) return null;
          out.push(encodeURIComponent(v));
          continue;
        }
        out.push(seg);
      }
      return out.join("/");
    }

    function collectKv(kind) {
      const host = document.querySelector("[data-slot=json-code-kv-rows][data-kv=" + kind + "]");
      if (!host) return [];
      const out = [];
      for (const row of host.querySelectorAll(".kv-row")) {
        const key = (row.querySelector(".kv-key")?.value || "").trim();
        const value = row.querySelector(".kv-val")?.value || "";
        if (!key && !value.trim()) continue;
        if ((kind === "headers" || kind === "headers-global") && key.toLowerCase() === "authorization") continue;
        out.push({ key, value });
      }
      return out;
    }

    function renderKv(kind) {
      const host = document.querySelector("[data-slot=json-code-kv-rows][data-kv=" + kind + "]");
      if (!host) return;
      let pairs;
      if (kind === "cookies") {
        pairs = readCookiePairs();
      } else if (kind === "path") {
        const template = sessionStorage.getItem(PATH_TEMPLATE_KEY) || "";
        const names = pathNames(template);
        if (names.length === 0) {
          host.innerHTML = '<p class="kv-empty">Select a parameterized GET route</p>';
          return;
        }
        const stored = Object.fromEntries(loadPairs(PATH_KEY).map((p) => [p.key, p.value]));
        pairs = names.map((n) => ({ key: n, value: stored[n] || "" }));
      } else if (kind === "headers") {
        pairs = loadPairs(HEADERS_KEY).filter((p) => String(p.key).toLowerCase() !== "authorization");
        if (pairs.length === 0) pairs = [{ key: "accept", value: ACCEPT }];
      } else if (kind === "headers-global") {
        pairs = loadPairs(HEADERS_GLOBAL_KEY).filter((p) => String(p.key).toLowerCase() !== "authorization");
      } else if (kind === "body") {
        pairs = loadPairs(BODY_FORM_KEY);
      } else {
        pairs = loadPairs(QUERY_KEY);
      }
      pairs = pairs.concat([{ key: "", value: "" }]);
      host.innerHTML = pairs.map((p) =>
        '<div class="kv-row">' +
          '<input class="kv-key" spellcheck="false" autocomplete="off" placeholder="Key" value="' + escAttr(p.key) + '" />' +
          '<input class="kv-val" spellcheck="false" autocomplete="off" placeholder="Value" value="' + escAttr(p.value ?? "") + '" />' +
        "</div>"
      ).join("");
    }

    function ensureSeeds() {
      if (!sessionStorage.getItem(HEADERS_KEY)) {
        savePairs(HEADERS_KEY, [{ key: "accept", value: ACCEPT }]);
      }
      if (sessionStorage.getItem(HEADERS_MODE_KEY) !== "custom") {
        sessionStorage.setItem(HEADERS_MODE_KEY, "inherit");
      }
      if (!sessionStorage.getItem(HEADERS_GLOBAL_KEY)) savePairs(HEADERS_GLOBAL_KEY, []);
      if (!sessionStorage.getItem(AUTH_KEY)) sessionStorage.setItem(AUTH_KEY, JSON.stringify(emptyAuth()));
      if (!sessionStorage.getItem(AUTH_GLOBAL_KEY)) sessionStorage.setItem(AUTH_GLOBAL_KEY, JSON.stringify(emptyAuth()));
      if (!sessionStorage.getItem(QUERY_KEY)) {
        const pairs = [];
        for (const [key, value] of new URLSearchParams(location.search)) pairs.push({ key, value });
        savePairs(QUERY_KEY, pairs);
      }
      if (!sessionStorage.getItem(BODY_MODE_KEY)) sessionStorage.setItem(BODY_MODE_KEY, "form");
      if (!sessionStorage.getItem(BODY_FORM_KEY)) savePairs(BODY_FORM_KEY, []);
      if (!sessionStorage.getItem(BODY_JSON_KEY)) sessionStorage.setItem(BODY_JSON_KEY, "");
      if (!sessionStorage.getItem(METHOD_KEY)) {
        const m = (page.getAttribute("data-method") || "GET").toUpperCase();
        sessionStorage.setItem(METHOD_KEY, m);
      }
      const pathAttr = page.getAttribute("data-path") || location.pathname;
      const template = sessionStorage.getItem(PATH_TEMPLATE_KEY);
      if (template) {
        const matched = (() => {
          const tParts = template.split("/");
          const pParts = pathAttr.split("/");
          if (tParts.length !== pParts.length) return null;
          const out = {};
          for (let i = 0; i < tParts.length; i += 1) {
            const t = tParts[i];
            const p = pParts[i];
            if (t.startsWith(":") && t.length > 1) {
              try { out[t.slice(1)] = decodeURIComponent(p); } catch { out[t.slice(1)] = p; }
              continue;
            }
            if (t !== p) return null;
          }
          return out;
        })();
        if (matched) {
          savePairs(PATH_KEY, Object.entries(matched).map(([key, value]) => ({ key, value })));
        }
      }
    }

    function emptyAuth() {
      return { type: "none", token: "", username: "", password: "", key: "", value: "", in: "header", mode: "inherit" };
    }

    function authStorageKey(scope) {
      return scope === "global" ? AUTH_GLOBAL_KEY : AUTH_KEY;
    }

    function loadAuth(key) {
      try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return emptyAuth();
        const parsed = JSON.parse(raw);
        const type = parsed && parsed.type;
        if (type !== "bearer" && type !== "basic" && type !== "apikey" && type !== "none") return emptyAuth();
        return {
          type,
          token: typeof parsed.token === "string" ? parsed.token : "",
          username: typeof parsed.username === "string" ? parsed.username : "",
          password: typeof parsed.password === "string" ? parsed.password : "",
          key: typeof parsed.key === "string" ? parsed.key : "",
          value: typeof parsed.value === "string" ? parsed.value : "",
          in: parsed.in === "query" ? "query" : "header",
          mode: parsed.mode === "custom" ? "custom" : "inherit",
        };
      } catch {
        return emptyAuth();
      }
    }

    function readAuth(scope) {
      const root = document.querySelector('[data-auth-scope="' + scope + '"]');
      if (!root) return loadAuth(authStorageKey(scope));
      const on = root.querySelector("[data-auth-type].is-on");
      const type = on ? on.getAttribute("data-auth-type") : "none";
      const field = (name) => {
        const input = root.querySelector('[data-auth-field="' + name + '"]');
        return input ? input.value : "";
      };
      const inBtn = root.querySelector("[data-auth-in].is-on");
      const modeBtn = root.querySelector("[data-auth-mode].is-on");
      const mode = modeBtn && modeBtn.getAttribute("data-auth-mode") === "custom" ? "custom" : "inherit";
      return {
        type: type === "bearer" || type === "basic" || type === "apikey" ? type : "none",
        token: field("token"),
        username: field("username"),
        password: field("password"),
        key: field("key"),
        value: field("value"),
        in: inBtn && inBtn.getAttribute("data-auth-in") === "query" ? "query" : "header",
        mode,
      };
    }

    function authLabel(auth) {
      if (auth.type === "bearer") return "Bearer";
      if (auth.type === "basic") return "Basic";
      if (auth.type === "apikey") return "API";
      return "No";
    }

    function paintAuth(scope, auth) {
      const root = document.querySelector('[data-auth-scope="' + scope + '"]');
      if (root) {
        for (const btn of root.querySelectorAll("[data-auth-type]")) {
          const on = btn.getAttribute("data-auth-type") === auth.type;
          btn.classList.toggle("is-on", on);
          btn.setAttribute("aria-pressed", on ? "true" : "false");
        }
        for (const pane of root.querySelectorAll("[data-auth-pane]")) {
          pane.hidden = pane.getAttribute("data-auth-pane") !== auth.type;
        }
        for (const btn of root.querySelectorAll("[data-auth-in]")) {
          const on = (btn.getAttribute("data-auth-in") || "header") === auth.in;
          btn.classList.toggle("is-on", on);
          btn.setAttribute("aria-pressed", on ? "true" : "false");
        }
        const mode = auth.mode === "custom" ? "custom" : "inherit";
        for (const btn of root.querySelectorAll("[data-auth-mode]")) {
          const on = btn.getAttribute("data-auth-mode") === mode;
          btn.classList.toggle("is-on", on);
          btn.setAttribute("aria-pressed", on ? "true" : "false");
        }
        const custom = root.querySelector("[data-auth-custom]");
        if (custom) custom.hidden = mode !== "custom";
      }
      if (scope === "global") {
        const btn = document.querySelector("[data-slot=json-code-global-auth]");
        if (btn) {
          const active = auth.type !== "none";
          btn.classList.toggle("is-on", active);
          btn.title = active ? "Global authentication · " + authLabel(auth) : "Global authentication";
        }
      }
    }

    function fillAuth(scope) {
      const auth = loadAuth(authStorageKey(scope));
      const root = document.querySelector('[data-auth-scope="' + scope + '"]');
      if (root) {
        const set = (name, value) => {
          const input = root.querySelector('[data-auth-field="' + name + '"]');
          if (input) input.value = value;
        };
        set("token", auth.token);
        set("username", auth.username);
        set("password", auth.password);
        set("key", auth.key);
        set("value", auth.value);
      }
      paintAuth(scope, auth);
    }

    function storedAuth(auth) {
      return auth;
    }

    function forgetSecretsOnReload() {
      try {
        const nav = performance.getEntriesByType("navigation")[0];
        if (!nav || nav.type !== "reload") return;
        const mark = String(nav.startTime);
        if (sessionStorage.getItem("oke:json-code:reload-seen") === mark) return;
        sessionStorage.setItem("oke:json-code:reload-seen", mark);
        for (const key of [AUTH_KEY, AUTH_GLOBAL_KEY]) {
          const auth = loadAuth(key);
          sessionStorage.setItem(key, JSON.stringify({ ...auth, token: "", password: "", value: "" }));
        }
      } catch {}
    }

    function persistAuth(scope) {
      const auth = readAuth(scope);
      sessionStorage.setItem(authStorageKey(scope), JSON.stringify(storedAuth(auth)));
      paintAuth(scope, auth);
    }

    function effectiveAuth() {
      const request = readAuth("request");
      if (request.mode === "custom") return request;
      return readAuth("global");
    }

    function basicAuthorization(user, pass) {
      const bytes = new TextEncoder().encode(String(user) + ":" + String(pass));
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      return "Basic " + btoa(bin);
    }

    function headersMode() {
      return sessionStorage.getItem(HEADERS_MODE_KEY) === "custom" ? "custom" : "inherit";
    }

    function paintHeadersMode(mode) {
      const next = mode === "custom" ? "custom" : "inherit";
      const root = document.querySelector('[data-rail-section="headers"]');
      if (!root) return;
      for (const btn of root.querySelectorAll("[data-headers-mode]")) {
        const on = btn.getAttribute("data-headers-mode") === next;
        btn.classList.toggle("is-on", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      }
      const custom = root.querySelector("[data-headers-custom]");
      if (custom) custom.hidden = next !== "custom";
    }

    function applyHeaderPairs(headers, pairs) {
      for (const p of pairs) {
        const k = (p.key || "").trim();
        if (!k || k.toLowerCase() === "authorization") continue;
        headers[k] = p.value ?? "";
      }
    }

    function requestHeaders(contentType) {
      const headers = { accept: ACCEPT };
      applyHeaderPairs(headers, loadPairs(HEADERS_GLOBAL_KEY));
      if (headersMode() === "custom") applyHeaderPairs(headers, loadPairs(HEADERS_KEY));
      const auth = effectiveAuth();
      if (auth.type === "bearer" && auth.token.trim()) {
        headers.authorization = "Bearer " + auth.token.trim();
      } else if (auth.type === "basic" && (auth.username || auth.password)) {
        headers.authorization = basicAuthorization(auth.username, auth.password);
      } else if (auth.type === "apikey" && auth.in !== "query" && auth.key.trim()) {
        headers[auth.key.trim()] = auth.value ?? "";
      }
      if (contentType) {
        const hasCt = Object.keys(headers).some((k) => k.toLowerCase() === "content-type");
        if (!hasCt) headers["content-type"] = contentType;
      }
      return headers;
    }

    function buildQueryUrl(pathname) {
      const params = new URLSearchParams();
      for (const p of loadPairs(QUERY_KEY)) {
        const k = (p.key || "").trim();
        if (!k) continue;
        params.set(k, p.value ?? "");
      }
      const auth = effectiveAuth();
      if (auth.type === "apikey" && auth.in === "query" && auth.key.trim()) {
        params.set(auth.key.trim(), auth.value ?? "");
      }
      const q = params.toString();
      return q ? pathname + "?" + q : pathname;
    }

    function buildRequestBody() {
      const mode = bodyMode();
      if (mode === "json") {
        const raw = (bodyRaw?.value ?? sessionStorage.getItem(BODY_JSON_KEY) ?? "").trim();
        if (!raw) return { ok: true, empty: true };
        try {
          JSON.parse(raw);
        } catch {
          return { ok: false, error: "Body must be valid JSON." };
        }
        return { ok: true, empty: false, body: raw, contentType: "application/json" };
      }
      const pairs = collectKv("body");
      if (pairs.length === 0) return { ok: true, empty: true };
      const params = new URLSearchParams();
      for (const p of pairs) params.set(p.key, p.value ?? "");
      return {
        ok: true,
        empty: false,
        body: params.toString(),
        contentType: "application/x-www-form-urlencoded",
      };
    }

    function escHtmlText(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    async function navigate(url, headers, init) {
      const opts = init && typeof init === "object" ? init : {};
      try {
        const res = await fetch(url, {
          credentials: "same-origin",
          ...opts,
          headers,
        });
        const text = await res.text();
        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("text/html")) {
          document.open();
          document.write(text);
          document.close();
          return;
        }
        let display = text;
        try { display = JSON.stringify(JSON.parse(text), null, 2); } catch {}
        document.open();
        document.write(
          "<!doctype html><html lang=\\"en\\"><head><meta charset=\\"utf-8\\"><meta name=\\"viewport\\" content=\\"width=device-width, initial-scale=1\\"><title>" +
            escHtmlText(String(res.status)) +
            "</title><style>body{margin:0;background:#111;color:#eee;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}pre{margin:0;padding:1rem;white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body><pre>" +
            escHtmlText(display) +
            "</pre></body></html>",
        );
        document.close();
      } catch {
        const method = String(opts.method || "GET").toUpperCase();
        if (method === "GET" || method === "HEAD") location.assign(url);
      }
    }

    function persistOptions() {
      writeCookies(collectKv("cookies"));
      savePairs(
        HEADERS_KEY,
        collectKv("headers").filter((p) => p.key.toLowerCase() !== "authorization"),
      );
      savePairs(
        HEADERS_GLOBAL_KEY,
        collectKv("headers-global").filter((p) => p.key.toLowerCase() !== "authorization"),
      );
      persistAuth("request");
      persistAuth("global");
      savePairs(QUERY_KEY, collectKv("query"));
      savePairs(BODY_FORM_KEY, collectKv("body"));
      if (bodyRaw) sessionStorage.setItem(BODY_JSON_KEY, bodyRaw.value);
      sessionStorage.setItem(BODY_MODE_KEY, bodyMode());
      const pathPairs = collectKv("path");
      if (pathPairs.length > 0) savePairs(PATH_KEY, pathPairs);
    }

    function resolveSendUrl() {
      const template = sessionStorage.getItem(PATH_TEMPLATE_KEY) || "";
      const names = pathNames(template);
      if (names.length > 0) {
        const values = Object.fromEntries(loadPairs(PATH_KEY).map((p) => [p.key, p.value]));
        const filled = fillPath(template, values);
        if (!filled) return null;
        return buildQueryUrl(filled);
      }
      const path = page.getAttribute("data-path") || location.pathname;
      return buildQueryUrl(path);
    }

    async function sendRequest() {
      persistOptions();
      const url = resolveSendUrl();
      if (!url) {
        openSection("path");
        renderKv("path");
        return;
      }
      const payloadBody = buildRequestBody();
      if (!payloadBody.ok) {
        setBodyError(payloadBody.error || "Invalid body");
        syncBodyMode("json");
        openSection("body");
        return;
      }
      setBodyError("");
      let method = currentMethod();
      if (!payloadBody.empty && !methodAllowsBody(method)) method = "POST";
      if (payloadBody.empty && !methodAllowsBody(method)) {
        // GET-style send — no body on the wire
        sendBtn.disabled = true;
        try {
          await navigate(url, requestHeaders());
        } finally {
          sendBtn.disabled = false;
        }
        return;
      }
      sendBtn.disabled = true;
      try {
        const headers = requestHeaders(payloadBody.empty ? undefined : payloadBody.contentType);
        await navigate(url, headers, {
          method,
          ...(payloadBody.empty ? {} : { body: payloadBody.body }),
        });
      } finally {
        sendBtn.disabled = false;
      }
    }

    function resetOptions() {
      savePairs(HEADERS_KEY, [{ key: "accept", value: ACCEPT }]);
      sessionStorage.setItem(HEADERS_MODE_KEY, "inherit");
      sessionStorage.setItem(AUTH_KEY, JSON.stringify(emptyAuth()));
      const pairs = [];
      for (const [key, value] of new URLSearchParams(location.search)) pairs.push({ key, value });
      savePairs(QUERY_KEY, pairs);
      savePairs(BODY_FORM_KEY, []);
      sessionStorage.setItem(BODY_JSON_KEY, "");
      sessionStorage.setItem(BODY_MODE_KEY, "form");
      const template = sessionStorage.getItem(PATH_TEMPLATE_KEY) || "";
      if (pathNames(template).length > 0) {
        savePairs(PATH_KEY, pathNames(template).map((n) => ({ key: n, value: "" })));
      }
      for (const kind of ["cookies", "headers", "query", "path", "body"]) renderKv(kind);
      paintHeadersMode("inherit");
      fillAuth("request");
      syncBodyMode("form");
      syncPathChapter();
    }

    function pathValuesFilled(template) {
      const names = pathNames(template);
      if (names.length === 0) return false;
      const stored = Object.fromEntries(loadPairs(PATH_KEY).map((p) => [p.key, p.value]));
      return names.every((n) => (stored[n] || "").trim().length > 0);
    }

    function authHasCredentials(auth) {
      if (auth.type === "bearer") return auth.token.trim().length > 0;
      if (auth.type === "basic") return Boolean(auth.username || auth.password);
      if (auth.type === "apikey") return auth.key.trim().length > 0;
      return false;
    }

    /** Address-bar loads omit sessionStorage credentials. Replay a 401 once. */
    function replayStoredAuth() {
      const status = Number(page.getAttribute("data-status") || "0");
      if (status !== 401) {
        try { sessionStorage.removeItem("oke:json-code:auth-replay"); } catch {}
        return;
      }
      const auth = effectiveAuth();
      if (!authHasCredentials(auth)) return;
      const method = (page.getAttribute("data-method") || "GET").toUpperCase();
      const path = page.getAttribute("data-path") || location.pathname;
      const stamp = [
        method, path, location.search, auth.type, auth.token, auth.username,
        auth.password, auth.key, auth.value, auth.in,
      ].join("\\0");
      try {
        if (sessionStorage.getItem("oke:json-code:auth-replay") === stamp) return;
        sessionStorage.setItem("oke:json-code:auth-replay", stamp);
      } catch {
        return;
      }
      rememberMethod(method, path);
      void sendRequest();
    }

    ensureSeeds();
    forgetSecretsOnReload();
    for (const kind of ["cookies", "headers", "headers-global", "query", "path", "body"]) renderKv(kind);
    paintHeadersMode(headersMode());
    fillAuth("request");
    fillAuth("global");
    syncBodyMode(bodyMode());
    syncPathChapter();
    replayStoredAuth();
    const saved = sessionStorage.getItem(SECTION_KEY) || "";
    if (SECTIONS.includes(saved)) openSection(saved);

    if (resetBtn) resetBtn.addEventListener("click", () => resetOptions());
    sendBtn.addEventListener("click", () => void sendRequest());
    for (const el of bodyModeBtns) {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const mode = el.getAttribute("data-mode") || "form";
        if (mode === "json" && bodyRaw) {
          savePairs(BODY_FORM_KEY, collectKv("body"));
        } else if (bodyRaw) {
          sessionStorage.setItem(BODY_JSON_KEY, bodyRaw.value);
        }
        syncBodyMode(mode);
      });
    }
    for (const el of document.querySelectorAll("[data-auth-reveal]")) {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const field = el.closest(".auth-field");
        const input = field ? field.querySelector("input") : null;
        if (!input) return;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        el.setAttribute("aria-pressed", show ? "true" : "false");
        el.setAttribute("aria-label", show ? "Hide secret" : "Show secret");
      });
    }
    for (const el of document.querySelectorAll("[data-headers-mode]")) {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const mode = el.getAttribute("data-headers-mode") === "custom" ? "custom" : "inherit";
        sessionStorage.setItem(HEADERS_MODE_KEY, mode);
        paintHeadersMode(mode);
        if (mode === "custom") renderKv("headers");
      });
    }
    for (const el of document.querySelectorAll("[data-auth-mode]")) {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const root = el.closest("[data-auth-scope]");
        if (!root) return;
        for (const btn of root.querySelectorAll("[data-auth-mode]")) {
          const on = btn === el;
          btn.classList.toggle("is-on", on);
          btn.setAttribute("aria-pressed", on ? "true" : "false");
        }
        const custom = root.querySelector("[data-auth-custom]");
        if (custom) custom.hidden = el.getAttribute("data-auth-mode") !== "custom";
        persistAuth(root.getAttribute("data-auth-scope") || "request");
      });
    }
    for (const el of document.querySelectorAll("[data-auth-type]")) {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const root = el.closest("[data-auth-scope]");
        if (!root) return;
        for (const btn of root.querySelectorAll("[data-auth-type]")) {
          const on = btn === el;
          btn.classList.toggle("is-on", on);
          btn.setAttribute("aria-pressed", on ? "true" : "false");
        }
        const type = el.getAttribute("data-auth-type") || "none";
        for (const pane of root.querySelectorAll("[data-auth-pane]")) {
          pane.hidden = pane.getAttribute("data-auth-pane") !== type;
        }
        persistAuth(root.getAttribute("data-auth-scope") || "request");
      });
    }
    if (bodyRaw) {
      bodyRaw.addEventListener("input", () => {
        sessionStorage.setItem(BODY_JSON_KEY, bodyRaw.value);
        refreshBodyHighlight({ soft: true });
      });
      bodyRaw.addEventListener("blur", () => prettyBodyJson());
      bodyRaw.addEventListener("scroll", () => {
        if (!bodyHi) return;
        bodyHi.style.transform = "translate(" + (-bodyRaw.scrollLeft) + "px," + (-bodyRaw.scrollTop) + "px)";
      });
    }

    for (const section of document.querySelectorAll(".rail-dock-body details[data-rail-section]")) {
      section.addEventListener("toggle", () => {
        if (!(section instanceof HTMLDetailsElement) || !section.open) return;
        const name = section.getAttribute("data-rail-section");
        if (!name) return;
        sessionStorage.setItem(SECTION_KEY, name);
        if (name === "auth") fillAuth("request");
        else if (name === "cookies" || name === "headers" || name === "query" || name === "path" || name === "body") {
          if (name === "body") syncBodyMode(bodyMode());
          else renderKv(name);
        }
      });
    }

    const globalPop = document.querySelector("[data-slot=json-code-global-panel]");
    const globalAuthBtn = document.querySelector("[data-slot=json-code-global-auth]");
    const globalHeadersBtn = document.querySelector("[data-slot=json-code-global-headers]");

    function paintGlobalHeaders() {
      if (!globalHeadersBtn) return;
      const n = loadPairs(HEADERS_GLOBAL_KEY).filter((p) => (p.key || "").trim() && String(p.key).toLowerCase() !== "authorization").length;
      globalHeadersBtn.classList.toggle("is-on", n > 0);
      globalHeadersBtn.title = n > 0 ? "Global headers · " + n : "Global headers";
    }

    function closeGlobal() {
      persistAuth("global");
      if (globalPop) globalPop.hidden = true;
      if (globalAuthBtn) globalAuthBtn.setAttribute("aria-expanded", "false");
      if (globalHeadersBtn) globalHeadersBtn.setAttribute("aria-expanded", "false");
    }

    function openGlobal(pane) {
      if (!globalPop) return;
      const same = !globalPop.hidden && globalPop.getAttribute("data-pane") === pane;
      if (same) {
        closeGlobal();
        return;
      }
      globalPop.hidden = false;
      globalPop.setAttribute("data-pane", pane);
      const authPane = globalPop.querySelector('[data-global-pane="auth"]');
      const headersPane = globalPop.querySelector('[data-global-pane="headers"]');
      if (authPane) authPane.hidden = pane !== "auth";
      if (headersPane) headersPane.hidden = pane !== "headers";
      if (globalAuthBtn) globalAuthBtn.setAttribute("aria-expanded", pane === "auth" ? "true" : "false");
      if (globalHeadersBtn) globalHeadersBtn.setAttribute("aria-expanded", pane === "headers" ? "true" : "false");
      if (pane === "headers") renderKv("headers-global");
      else fillAuth("global");
    }

    paintGlobalHeaders();
    if (globalAuthBtn) globalAuthBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openGlobal("auth");
    });
    if (globalHeadersBtn) globalHeadersBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openGlobal("headers");
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      if (!t.closest(".rail-dock")) return;
      e.preventDefault();
      void sendRequest();
    });

    function selectRouteLeaf(leaf) {
      for (const node of document.querySelectorAll("a.leaf.is-on, button.leaf.is-on")) {
        node.classList.remove("is-on");
      }
      leaf.classList.add("is-on");
      const method = (leaf.getAttribute("data-method") || currentMethod()).toUpperCase();
      const path = leaf.getAttribute("data-path") || leaf.getAttribute("data-param-template") || currentPath();
      paintRequestLine(method, path);
      const title = document.querySelector("title");
      if (title) {
        const app = page.querySelector(".title")?.textContent || "";
        title.textContent = method + " " + path + (app ? " · " + app : "");
      }
    }

    document.addEventListener("input", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      const authRoot = t.closest("[data-auth-scope]");
      if (authRoot) {
        persistAuth(authRoot.getAttribute("data-auth-scope") || "request");
        return;
      }
      if (t.closest('[data-kv="headers-global"]')) {
        savePairs(
          HEADERS_GLOBAL_KEY,
          collectKv("headers-global").filter((p) => p.key.toLowerCase() !== "authorization"),
        );
        paintGlobalHeaders();
      }
    });

    document.addEventListener("click", (e) => {
      const t = e.target;
      const el = t instanceof Element ? t : t && t.parentElement;
      if (!el) return;
      const authIn = el.closest("[data-auth-in]");
      if (authIn) {
        e.preventDefault();
        const root = authIn.closest("[data-auth-scope]");
        if (!root) return;
        for (const btn of root.querySelectorAll("[data-auth-in]")) {
          const on = btn === authIn;
          btn.classList.toggle("is-on", on);
          btn.setAttribute("aria-pressed", on ? "true" : "false");
        }
        persistAuth(root.getAttribute("data-auth-scope") || "request");
        return;
      }
      if (globalPop && !globalPop.hidden && !el.closest("[data-slot=json-code-global-panel]") && !el.closest("[data-slot=json-code-global-auth]") && !el.closest("[data-slot=json-code-global-headers]")) {
        closeGlobal();
      }
      const paramLeaf = el.closest("button.leaf[data-param-template]");
      if (paramLeaf) {
        e.preventDefault();
        const template = paramLeaf.getAttribute("data-param-template") || "";
        rememberMethod(
          paramLeaf.getAttribute("data-method") || "GET",
          template,
        );
        sessionStorage.setItem(PATH_TEMPLATE_KEY, template);
        const names = pathNames(template);
        const stored = Object.fromEntries(loadPairs(PATH_KEY).map((p) => [p.key, p.value]));
        const next = names.map((n) => ({ key: n, value: stored[n] || "" }));
        savePairs(PATH_KEY, next);
        syncPathChapter();
        selectRouteLeaf(paramLeaf);
        openSection(pathValuesFilled(template) ? "query" : "path");
        return;
      }
      const optionsLeaf = el.closest("button.leaf[data-route-options]");
      if (optionsLeaf) {
        e.preventDefault();
        rememberMethod(
          optionsLeaf.getAttribute("data-method") || "POST",
          optionsLeaf.getAttribute("data-path") || page.getAttribute("data-path") || location.pathname,
        );
        sessionStorage.removeItem(PATH_TEMPLATE_KEY);
        syncPathChapter();
        selectRouteLeaf(optionsLeaf);
        openSection(methodAllowsBody(optionsLeaf.getAttribute("data-method")) ? "body" : "query");
        return;
      }
      const routeLeaf = el.closest("a.leaf[data-route-leaf][href]");
      if (routeLeaf) {
        e.preventDefault();
        rememberMethod(
          routeLeaf.getAttribute("data-method") || "GET",
          routeLeaf.getAttribute("data-path") || "",
        );
        sessionStorage.removeItem(PATH_TEMPLATE_KEY);
        syncPathChapter();
        selectRouteLeaf(routeLeaf);
        openSection(methodAllowsBody(routeLeaf.getAttribute("data-method")) ? "body" : "query");
        return;
      }
      const a = el.closest("a[data-nav][href]");
      if (!a || !a.getAttribute("href")) return;
      if (a.target === "_blank") return;
      e.preventDefault();
      const href = a.getAttribute("href") || "";
      let url = href;
      try {
        const u = new URL(href, location.origin);
        url = buildQueryUrl(u.pathname);
        if (href.includes("raw=1") || u.searchParams.has("raw")) {
          const params = new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?") + 1) : "");
          params.set("raw", "1");
          url = u.pathname + "?" + params.toString();
        }
      } catch {}
      void navigate(url, requestHeaders());
    });

    if (btn && payload) {
      btn.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(payload.value); } catch { payload.select(); document.execCommand("copy"); }
        btn.setAttribute("aria-label", "Copied");
        btn.title = "Copied";
        if (copyIcon) copyIcon.hidden = true;
        if (doneIcon) doneIcon.hidden = false;
        setTimeout(() => {
          btn.setAttribute("aria-label", "Copy code");
          btn.title = "Copy code";
          if (copyIcon) copyIcon.hidden = false;
          if (doneIcon) doneIcon.hidden = true;
        }, 1600);
      });
    }
  })();
  </script>
</body>
</html>
`;
}

/**
 * Wrap a JSON GET response in the browser code-block page when Accept prefers HTML.
 *
 * @param request - Incoming request
 * @param response - Encoded envelope
 * @param app - Manifest app name
 * @param nav - Route groups for the right-rail tree
 * @param latencyMs - Handler elapsed time
 * @param cache - Wide-event cache dimension
 * @param auth - Auth principal that handled the request
 */
export async function asBrowserJsonCodeBlock(
  request: Request,
  response: Response,
  app: string,
  nav: readonly JsonCodeNavGroup[] = [],
  latencyMs?: number,
  cache: JsonCodeCache = "none",
  auth: JsonCodeAuth = { kind: "none" },
): Promise<Response> {
  if (!shouldRenderJsonCodeBlock(request, response)) return response;
  const json = await response.text();
  const url = new URL(request.url);
  const html = renderJsonCodeBlockHtml({
    json,
    status: response.status,
    method: request.method.toUpperCase(),
    path: url.pathname,
    app,
    rawHref: rawHrefFromRequest(request),
    prettyHref: prettyHrefFromRequest(request),
    compact: url.searchParams.has("raw"),
    nav,
    latencyMs,
    cache,
    auth,
    headers: jsonCodeResponseHeaders(response.headers),
  });
  const headers = new Headers(response.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.delete("content-length");
  const vary = headers.get("vary");
  if (!vary) headers.set("vary", "Accept");
  else if (!/\baccept\b/i.test(vary)) headers.set("vary", `${vary}, Accept`);
  return new Response(html, { status: response.status, headers });
}

/** Stroke icon, 14px, currentColor. */
function glyph(body: string, size = 14): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${body}</svg>`;
}

const GLYPH = {
  clock: glyph(
    `<circle cx="12" cy="12" r="7.5" stroke="currentColor" stroke-width="1.5"/><path d="M12 8v4.5l2.5 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  ),
  dot: glyph(`<circle cx="12" cy="12" r="3.25" fill="currentColor"/>`, 12),
  eye: glyph(
    `<path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="2.25" stroke="currentColor" stroke-width="1.5"/>`,
  ),
  plus: glyph(
    `<path d="M12 5.5v13M5.5 12h13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`,
  ),
  pencil: glyph(
    `<path d="M4 16.5V20h3.5L19 8.5 15.5 5 4 16.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
  ),
  trash: glyph(
    `<path d="M5 7.5h14M9.5 7.5V5.5h5v2M8 7.5l.7 12h6.6L16 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  file: glyph(
    `<path d="M7 3.5h7.2L19 8.2V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 7 20V3.5Z" stroke="currentColor" stroke-width="1.5"/><path d="M14 3.5V8h5" stroke="currentColor" stroke-width="1.5"/>`,
  ),
  sliders: glyph(
    `<path d="M4 8h16M4 16h16M9 6v4M16 14v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  ),
  search: glyph(
    `<circle cx="11" cy="11" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="M15.5 15.5 19.5 19.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  ),
  braces: glyph(
    `<path d="M9 5.5c-1.6 0-2.5 1-2.5 2.6v2.2c0 1-.5 1.5-1.7 1.7 1.2.2 1.7.7 1.7 1.7v2.2c0 1.6.9 2.6 2.5 2.6M15 5.5c1.6 0 2.5 1 2.5 2.6v2.2c0 1 .5 1.5 1.7 1.7-1.2.2-1.7.7-1.7 1.7v2.2c0 1.6-.9 2.6-2.5 2.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  ),
  cookie: glyph(
    `<circle cx="12" cy="12" r="7.5" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="10" r=".9" fill="currentColor"/><circle cx="14" cy="9.5" r=".9" fill="currentColor"/><circle cx="13" cy="14" r=".9" fill="currentColor"/>`,
  ),
  list: glyph(
    `<path d="M9 7h10M9 12h10M9 17h10M5 7h.01M5 12h.01M5 17h.01" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`,
  ),
  key: glyph(
    `<circle cx="8" cy="14" r="3.25" stroke="currentColor" stroke-width="1.5"/><path d="M11 12.2 19 4.5M16.2 4.5H19V7.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  route: glyph(
    `<path d="M5 19V7.5A2 2 0 0 1 7 5.5h5M12 5.5 15.5 9 12 12.5M15 12h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
} as const;

/** Accent class for an HTTP method. Matches Console traces. */
function methodTone(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "get";
    case "QUERY":
      return "query";
    case "POST":
      return "post";
    case "PUT":
      return "put";
    case "PATCH":
      return "patch";
    case "DELETE":
      return "delete";
    case "HEAD":
      return "head";
    case "OPTIONS":
      return "options";
    default:
      return "other";
  }
}

/** Glyph for an HTTP method. */
function methodGlyph(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return GLYPH.eye;
    case "QUERY":
      return GLYPH.search;
    case "POST":
      return GLYPH.plus;
    case "PUT":
    case "PATCH":
      return GLYPH.pencil;
    case "DELETE":
      return GLYPH.trash;
    case "OPTIONS":
      return GLYPH.sliders;
    default:
      return GLYPH.file;
  }
}

const SECTION_GLYPH: Readonly<Record<string, string>> = {
  query: GLYPH.sliders,
  body: GLYPH.braces,
  cookies: GLYPH.cookie,
  headers: GLYPH.list,
  auth: GLYPH.key,
  path: GLYPH.route,
};

/** Status accent: ok, redirect, client error, server error. */
function statusTone(status: number): "ok" | "info" | "warn" | "err" {
  if (status >= 500) return "err";
  if (status >= 400) return "warn";
  if (status >= 300) return "info";
  return "ok";
}

function latencyHtml(ms: number | undefined): string {
  if (ms === undefined) return "";
  const tone = jsonCodeLatencyTone(ms);
  const label = formatJsonCodeLatency(ms);
  return `<span class="count lat-${tone}" data-slot="json-code-latency" data-tone="${tone}" title="Latency">${GLYPH.clock}${escapeHtml(label)}</span>`;
}

const CACHE_MARK: Readonly<
  Record<JsonCodeCache, { readonly title: string; readonly text: string; readonly icon: string }>
> = {
  hit: {
    title: "Cache hit",
    text: "Hit",
    icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
  },
  miss: {
    title: "Cache miss",
    text: "Miss",
    icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M4 4l16 16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  },
  none: {
    title: "Cache not applicable",
    text: "None",
    icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="7.5" stroke="currentColor" stroke-width="1.5"/><path d="M7 17 17 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  },
};

function cacheHtml(cache: JsonCodeCache | undefined): string {
  const mark = CACHE_MARK[cache ?? "none"];
  return `<span class="count cache cache-${cache ?? "none"}" data-slot="json-code-cache" data-cache="${cache ?? "none"}" title="${mark.title}">${mark.icon}${escapeHtml(mark.text)}</span>`;
}

const AUTH_MARK: Readonly<
  Record<JsonCodeAuthKind, { readonly title: string; readonly text: string; readonly icon: string }>
> = {
  none: {
    title: "Unauthenticated",
    text: "None",
    icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.5"/><path d="M5 19.5c1.8-3.2 4-4.8 7-4.8s5.2 1.6 7 4.8M4 4l16 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  },
  public: {
    title: "Public — intentionally unauthenticated",
    text: "Public",
    icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M4 12h16M12 4c2.5 2.8 2.5 13.2 0 16M12 4c-2.5 2.8-2.5 13.2 0 16" stroke="currentColor" stroke-width="1.5"/></svg>`,
  },
  user: {
    title: "Authenticated user",
    text: "User",
    icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.5"/><path d="M5 19.5c1.8-3.2 4-4.8 7-4.8s5.2 1.6 7 4.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  },
  key: {
    title: "API key",
    text: "Key",
    icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="8" cy="14" r="3.5" stroke="currentColor" stroke-width="1.5"/><path d="M11 12.5 19 4.5M16.5 4.5h3v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  },
  operator: {
    title: "Operator",
    text: "Operator",
    icon: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.5 19 7v5c0 4.5-2.9 7.8-7 9-4.1-1.2-7-4.5-7-9V7l7-3.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
  },
};

function authHtml(auth: JsonCodeAuth | undefined): string {
  const value = auth ?? { kind: "none" as const };
  const mark = AUTH_MARK[value.kind];
  const label =
    value.kind === "user" || value.kind === "key" || value.kind === "operator"
      ? value.id?.trim() || mark.text
      : mark.text;
  const title =
    value.id && (value.kind === "user" || value.kind === "key" || value.kind === "operator")
      ? `${mark.title} · ${value.id}`
      : mark.title;
  return `<span class="count auth auth-${value.kind}" data-slot="json-code-auth" data-auth="${value.kind}" title="${escapeHtml(title)}">${mark.icon}<span class="auth-label">${escapeHtml(label)}</span></span>`;
}

function authSwitchHtml(): string {
  const opt = (type: string, text: string) =>
    `<button type="button" class="token${type === "none" ? " is-on" : ""}" data-auth-type="${type}" aria-pressed="${type === "none" ? "true" : "false"}">${text}</button>`;
  return `<span class="body-mode-strip" role="group" aria-label="Authorization">${opt("none", "No")}${opt("bearer", "Bearer")}${opt("basic", "Basic")}${opt("apikey", "API")}</span>`;
}

const AUTH_EYE = `<svg class="eye-open" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="2.5" stroke="currentColor" stroke-width="1.5"/></svg><svg class="eye-shut" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 4.5 21 19.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M9.2 6.9A11 11 0 0 1 12 6.5c6 0 9.5 5.5 9.5 5.5a17 17 0 0 1-3.4 3.7M6.1 8.2C3.9 9.7 2.5 12 2.5 12S6 17.5 12 17.5c1.1 0 2.1-.2 3.1-.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

/** Masked credential input. The value stays for this tab; a refresh clears it. */
function secretInput(name: string, placeholder: string): string {
  return `<input class="kv-val" type="password" data-auth-field="${name}" spellcheck="false" autocomplete="off" placeholder="${placeholder}" /><button type="button" class="auth-reveal" data-auth-reveal aria-pressed="false" aria-label="Show secret">${AUTH_EYE}</button>`;
}

function authEditorHtml(scope: "request" | "global"): string {
  const none =
    scope === "global"
      ? "No global credentials. Each request uses its own Authorization."
      : "No credentials on this request.";
  const switchRow =
    scope === "global" ? authSwitchHtml() : `<div class="strip">${authSwitchHtml()}</div>`;
  return `<div class="auth-editor" data-slot="json-code-auth-editor">
    ${switchRow}
    <p class="kv-empty" data-auth-pane="none">${none}</p>
    <div class="auth-pane" data-auth-pane="bearer" hidden>
      <label class="auth-field"><span class="auth-lab">Token</span>${secretInput("token", "Token")}</label>
    </div>
    <div class="auth-pane" data-auth-pane="basic" hidden>
      <label class="auth-field"><span class="auth-lab">Username</span><input class="kv-val" data-auth-field="username" spellcheck="false" autocomplete="off" placeholder="Username" /></label>
      <label class="auth-field"><span class="auth-lab">Password</span>${secretInput("password", "Password")}</label>
    </div>
    <div class="auth-pane" data-auth-pane="apikey" hidden>
      <label class="auth-field"><span class="auth-lab">Key</span><input class="kv-val" data-auth-field="key" spellcheck="false" autocomplete="off" placeholder="X-Api-Key" /></label>
      <label class="auth-field"><span class="auth-lab">Value</span>${secretInput("value", "Value")}</label>
      <div class="auth-field">
        <span class="auth-lab">Add to</span>
        <span class="auth-in" role="group" aria-label="API key location">
          <button type="button" class="token is-on" data-auth-in="header" aria-pressed="true">Header</button>
          <button type="button" class="token" data-auth-in="query" aria-pressed="false">Query</button>
        </span>
      </div>
    </div>
  </div>`;
}

function navHtml(nav: readonly JsonCodeNavGroup[] | undefined): string {
  const groups = (nav ?? []).map(navGroupHtml).join("");
  const chev = `<span class="chev" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 9.5 12 15.5 18 9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
  const play = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 5.5v13l11-6.5L8 5.5Z" fill="currentColor"/></svg>`;
  const kvSection = (kind: string, label: string) =>
    `<details class="rail-acc" data-rail-section="${kind}">
  <summary class="rail-acc-sum">${chev}<span class="sec-ico">${SECTION_GLYPH[kind] ?? ""}</span><span>${label}</span></summary>
  <div class="rail-acc-body">
    <div class="kv-editor">
      <div class="kv-rows" data-slot="json-code-kv-rows" data-kv="${kind}"></div>
    </div>
  </div>
</details>`;
  return `<input class="rail-check" type="checkbox" id="json-code-rail">
<aside class="rail" data-slot="json-code-nav-panel" aria-label="Request">
  <header class="strip rail-toolbar">
    <p class="head">Request</p>
    <label class="copy" for="json-code-rail" aria-label="Collapse request" title="Collapse request">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 5.5 15.5 12 9 18.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </label>
  </header>
  <div class="rail-dock" data-slot="json-code-request-dock">
    <div class="strip rail-dock-strip">
      <span class="head">${play}<span>Request</span></span>
      <span class="grow"></span>
      <button type="button" class="token" data-slot="json-code-reset" title="Reset options to defaults">Reset</button>
      <span class="sep" aria-hidden="true"></span>
      <button type="button" class="dock-send" data-slot="json-code-send" title="Send request">${play}Send</button>
    </div>
    <div class="rail-dock-body">
      ${kvSection("query", "Params")}
      ${kvSection("path", "Path")}
      <details class="rail-acc" data-rail-section="body">
        <summary class="rail-acc-sum">
          ${chev}<span class="sec-ico">${SECTION_GLYPH.body}</span><span>Body</span>
          <span class="grow"></span>
          <span class="body-mode-strip" role="group" aria-label="Body format">
            <button type="button" class="token is-on" data-slot="json-code-body-mode" data-mode="form" aria-pressed="true">Form</button>
            <button type="button" class="token" data-slot="json-code-body-mode" data-mode="json" aria-pressed="false">JSON</button>
          </span>
        </summary>
        <div class="rail-acc-body">
          <div class="kv-editor" data-slot="json-code-body-form">
            <div class="kv-rows" data-slot="json-code-kv-rows" data-kv="body"></div>
          </div>
          <div class="body-json-wrap" data-slot="json-code-body-json" hidden>
            <div class="body-json-editor" data-slot="json-code-body-editor">
              <pre class="body-json-hi" data-slot="json-code-body-hi" aria-hidden="true"></pre>
              <textarea class="body-json" data-slot="json-code-body-raw" spellcheck="false" autocomplete="off" aria-label="JSON body" placeholder='{"key":"value"}'></textarea>
            </div>
            <p class="body-json-error" data-slot="json-code-body-error" hidden role="alert"></p>
          </div>
        </div>
      </details>
      <details class="rail-acc" data-rail-section="headers">
        <summary class="rail-acc-sum">
          ${chev}<span class="sec-ico">${SECTION_GLYPH.headers}</span><span>Headers</span>
          <span class="grow"></span>
          <span class="body-mode-strip" role="group" aria-label="Request headers">
            <button type="button" class="token is-on" data-headers-mode="inherit" aria-pressed="true">Inherit</button>
            <button type="button" class="token" data-headers-mode="custom" aria-pressed="false">Custom</button>
          </span>
        </summary>
        <div class="rail-acc-body" data-headers-custom hidden>
          <div class="kv-editor">
            <div class="kv-rows" data-slot="json-code-kv-rows" data-kv="headers"></div>
          </div>
        </div>
      </details>
      <details class="rail-acc" data-rail-section="auth" data-auth-scope="request">
        <summary class="rail-acc-sum">${chev}<span class="sec-ico">${SECTION_GLYPH.auth}</span><span>Auth</span><span class="grow"></span><span class="body-mode-strip" role="group" aria-label="Request auth"><button type="button" class="token is-on" data-auth-mode="inherit" aria-pressed="true">Inherit</button><button type="button" class="token" data-auth-mode="custom" aria-pressed="false">Custom</button></span></summary>
        <div class="rail-acc-body" data-auth-custom hidden>
          ${authEditorHtml("request")}
        </div>
      </details>
      ${kvSection("cookies", "Cookies")}
    </div>
  </div>
  <div class="rail-nav" data-rail-section="routes">
    <input class="routes-check" type="checkbox" id="json-code-routes" checked>
    <p class="rail-sec-label">
      <span>Routes</span>
      <label class="copy routes-collapse" for="json-code-routes" aria-label="Collapse routes" title="Collapse routes">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9.5 12 15.5 18 9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </label>
      <label class="copy routes-expand" for="json-code-routes" aria-label="Expand routes" title="Expand routes">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 14.5 12 8.5 18 14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </label>
    </p>
    <ul class="rail-list">${groups}</ul>
  </div>
</aside>
<label class="rail-thin" for="json-code-rail" aria-label="Expand request" title="Expand request">
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 5.5 8.5 12 15 18.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  <span>Request</span>
</label>`;
}

function navGroupHtml(group: JsonCodeNavGroup): string {
  const leaves = group.routes.map(navRouteHtml).join("");
  const open = group.routes.some((route) => route.current) ? " open" : "";
  return `<li>
    <details${open}>
      <summary class="band">
        <span class="chev" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 9.5 12 15.5 18 9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span class="band-name">${escapeHtml(group.name)}</span>
      </summary>
      <ul class="cols">${leaves}</ul>
    </details>
  </li>`;
}

function navRouteHtml(route: JsonCodeNavRoute): string {
  const on = route.current ? " is-on" : "";
  const meta = `data-route-leaf data-method="${escapeHtml(route.method)}" data-path="${escapeHtml(route.path)}"`;
  const inner = `<span class="leaf-path">${escapeHtml(route.path)}</span><span class="leaf-type">${escapeHtml(route.method)}</span>`;
  if (route.href) {
    return `<li><a class="leaf${on}" ${meta} href="${escapeHtml(route.href)}">${inner}</a></li>`;
  }
  if (route.paramNames.length > 0) {
    return `<li><button type="button" class="leaf${on}" ${meta} data-param-template="${escapeHtml(route.path)}">${inner}</button></li>`;
  }
  return `<li><button type="button" class="leaf${on}" ${meta} data-route-options="1">${inner}</button></li>`;
}

function isJsonIdent(ch: string | undefined): boolean {
  if (!ch) return false;
  return (
    (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_"
  );
}

function scanJsonString(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"') return i + 1;
    i += 1;
  }
  return source.length;
}

function scanJsonNumber(source: string, start: number): number {
  let i = start;
  if (source[i] === "-") i += 1;
  while (i < source.length && source[i]! >= "0" && source[i]! <= "9") i += 1;
  if (source[i] === ".") {
    i += 1;
    while (i < source.length && source[i]! >= "0" && source[i]! <= "9") i += 1;
  }
  const exp = source[i];
  if (exp === "e" || exp === "E") {
    i += 1;
    if (source[i] === "+" || source[i] === "-") i += 1;
    while (i < source.length && source[i]! >= "0" && source[i]! <= "9") i += 1;
  }
  return i;
}

function markJsonKeys(tokens: readonly JsonCodeToken[]): JsonCodeToken[] {
  const out: JsonCodeToken[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.kind !== "string") {
      out.push(token);
      continue;
    }
    let j = i + 1;
    while (j < tokens.length && tokens[j]?.kind === "space") j += 1;
    out.push(
      tokens[j]?.kind === "punct" && tokens[j]?.text === ":"
        ? { kind: "key", text: token.text }
        : token,
    );
  }
  return out;
}

function splitTokenLines(tokens: readonly JsonCodeToken[]): JsonCodeToken[][] {
  const lines: JsonCodeToken[][] = [[]];
  for (const token of tokens) {
    if (token.kind !== "space" || !token.text.includes("\n")) {
      lines[lines.length - 1]!.push(token);
      continue;
    }
    const parts = token.text.split("\n");
    for (let p = 0; p < parts.length; p += 1) {
      const piece = parts[p]!;
      if (piece.length > 0) lines[lines.length - 1]!.push({ kind: "space", text: piece });
      if (p < parts.length - 1) lines.push([]);
    }
  }
  return lines;
}

function tokenHtml(token: JsonCodeToken): string {
  const text = escapeHtml(token.text);
  switch (token.kind) {
    case "key":
      return `<span class="k">${text}</span>`;
    case "string":
      return `<span class="s">${text}</span>`;
    case "number":
      return `<span class="m">${text}</span>`;
    case "literal":
      return `<span class="l">${text}</span>`;
    case "punct":
      return `<span class="p">${text}</span>`;
    default:
      return text;
  }
}
