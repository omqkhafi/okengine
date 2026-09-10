/**
 * Browser GET → traces-language JSON page. Clients still get the envelope.
 */

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

/**
 * Full-bleed traces-language page for one JSON envelope.
 *
 * @param options - Envelope + chrome
 */
export function renderJsonCodeBlockHtml(options: JsonCodeBlockRenderOptions): string {
  const compact = options.compact === true;
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
.file {
  display: inline-flex;
  align-items: center;
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
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}
.rail-sec-label {
  display: flex;
  align-items: center;
  height: 2.5rem;
  margin: 0;
  padding: 0 .5rem;
  flex-shrink: 0;
  border-bottom: 1px solid var(--line);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--mute);
}
.rail-dock {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  max-height: 55%;
  min-height: 0;
  border-top: 1px solid var(--line);
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
  <main class="page" data-slot="json-code-block" data-state="complete" data-view="${compact ? "raw" : "pretty"}" data-status="${options.status}" data-method="${escapeHtml(options.method)}" data-path="${escapeHtml(options.path)}">
    <header class="strip">
      <span class="title">${escapeHtml(options.app)}</span>
      <span class="count">${options.status}</span>
      ${latencyHtml(options.latencyMs)}
      ${cacheHtml(options.cache)}
      ${authHtml(options.auth)}
      <span class="grow"></span>
      <span class="sep" aria-hidden="true"></span>
      <a
        class="token is-on"
        data-nav
        data-slot="json-code-view-toggle"
        href="${escapeHtml(compact ? options.prettyHref : options.rawHref)}"
        aria-pressed="${compact ? "true" : "false"}"
        title="${compact ? "Show pretty JSON" : "Show compact JSON"}"
      >${compact ? "Raw" : "Pretty"}</a>
    </header>
    <header class="strip">
      <span class="icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M7 3.5h7.2L19 8.2V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 7 20V3.5Z" stroke="currentColor" stroke-width="1.5"/><path d="M14 3.5V8h5" stroke="currentColor" stroke-width="1.5"/></svg>
      </span>
      <span class="file">${escapeHtml(title)}</span>
      <span class="head">json</span>
      <span class="state">${ok ? "Ready" : options.status}</span>
      <button class="copy" type="button" data-slot="json-code-copy" aria-label="Copy code" title="Copy code">
        <svg data-copy width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M5 16V5.5A1.5 1.5 0 0 1 6.5 4H16" stroke="currentColor" stroke-width="1.5"/></svg>
        <svg data-done hidden width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5 9.2 17 19 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </header>
    <div class="body">
      <div class="view"><pre>${rows}</pre></div>
      ${navHtml(options.nav)}
    </div>
  </main>
  <textarea id="payload" hidden>${escapeHtml(code)}</textarea>
  <script>
  (() => {
    const HEADERS_KEY = "oke:json-code:headers";
    const QUERY_KEY = "oke:json-code:query";
    const PATH_KEY = "oke:json-code:path";
    const PATH_TEMPLATE_KEY = "oke:json-code:path-template";
    const METHOD_KEY = "oke:json-code:method";
    const BODY_MODE_KEY = "oke:json-code:body-mode";
    const BODY_FORM_KEY = "oke:json-code:body-form";
    const BODY_JSON_KEY = "oke:json-code:body-json";
    const SECTION_KEY = "oke:json-code:rail-section";
    const ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    const SECTIONS = ["query", "body", "cookies", "headers", "path"];
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
      if (name === "cookies" || name === "headers" || name === "query" || name === "path" || name === "body") {
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
        if (kind === "headers" && key.toLowerCase() === "authorization") continue;
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

    function requestHeaders(contentType) {
      const headers = { accept: ACCEPT };
      for (const p of loadPairs(HEADERS_KEY)) {
        const k = (p.key || "").trim();
        if (!k) continue;
        const lower = k.toLowerCase();
        if (lower === "authorization") continue;
        headers[k] = p.value ?? "";
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
      syncBodyMode("form");
      syncPathChapter();
    }

    function pathValuesFilled(template) {
      const names = pathNames(template);
      if (names.length === 0) return false;
      const stored = Object.fromEntries(loadPairs(PATH_KEY).map((p) => [p.key, p.value]));
      return names.every((n) => (stored[n] || "").trim().length > 0);
    }

    ensureSeeds();
    for (const kind of ["cookies", "headers", "query", "path", "body"]) renderKv(kind);
    syncBodyMode(bodyMode());
    syncPathChapter();
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
        if (name === "cookies" || name === "headers" || name === "query" || name === "path" || name === "body") {
          if (name === "body") syncBodyMode(bodyMode());
          else renderKv(name);
        }
      });
    }

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
      const file = document.querySelector(".file");
      if (file) file.textContent = method + " " + path;
      const title = document.querySelector("title");
      if (title) {
        const app = page.querySelector(".title")?.textContent || "";
        title.textContent = method + " " + path + (app ? " · " + app : "");
      }
    }

    document.addEventListener("click", (e) => {
      const t = e.target;
      const el = t instanceof Element ? t : t && t.parentElement;
      if (!el) return;
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
  });
  const headers = new Headers(response.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.delete("content-length");
  const vary = headers.get("vary");
  if (!vary) headers.set("vary", "Accept");
  else if (!/\baccept\b/i.test(vary)) headers.set("vary", `${vary}, Accept`);
  return new Response(html, { status: response.status, headers });
}

function latencyHtml(ms: number | undefined): string {
  if (ms === undefined) return "";
  const tone = jsonCodeLatencyTone(ms);
  const label = formatJsonCodeLatency(ms);
  return `<span class="count lat-${tone}" data-slot="json-code-latency" data-tone="${tone}" title="Latency">${escapeHtml(label)}</span>`;
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

function navHtml(nav: readonly JsonCodeNavGroup[] | undefined): string {
  const groups = (nav ?? []).map(navGroupHtml).join("");
  const chev = `<span class="chev" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 9.5 12 15.5 18 9.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
  const play = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 5.5v13l11-6.5L8 5.5Z" fill="currentColor"/></svg>`;
  const kvSection = (kind: string, label: string) =>
    `<details class="rail-acc" data-rail-section="${kind}">
  <summary class="rail-acc-sum">${chev}<span>${label}</span></summary>
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
  <div class="rail-nav" data-rail-section="routes">
    <p class="rail-sec-label">Routes</p>
    <ul class="rail-list">${groups}</ul>
  </div>
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
      <details class="rail-acc" data-rail-section="body">
        <summary class="rail-acc-sum">
          ${chev}<span>Body</span>
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
      ${kvSection("cookies", "Cookies")}
      ${kvSection("headers", "Headers")}
      ${kvSection("path", "Path")}
    </div>
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
