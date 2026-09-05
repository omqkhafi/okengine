/**
 * Browser JSON code-block — Accept negotiation, highlight, HTML envelope.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { oke } from "../kernel/app.ts";
import { flow, resetFlowSeq } from "../kernel/flow.ts";
import { on, resetBindings } from "../kernel/on.ts";
import { http } from "../kernel/triggers.ts";
import {
  acceptQuality,
  asBrowserJsonCodeBlock,
  consoleUrlFromRequest,
  escapeHtml,
  fillPathTemplate,
  formatJsonCodeLatency,
  jsonCodeAuthFrom,
  jsonCodeLatencyTone,
  httpGetNavPaths,
  httpNavGroups,
  matchPathTemplate,
  pathParamNames,
  prefersHtml,
  prettyHrefFromRequest,
  prettyJson,
  rawHrefFromRequest,
  renderJsonCodeBlockHtml,
  shouldRenderJsonCodeBlock,
  tokenizeJson,
} from "./json-code-block.ts";

const CHROME_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

describe("prefersHtml", () => {
  test("Chrome navigation prefers HTML over */* JSON", () => {
    expect(prefersHtml(CHROME_ACCEPT)).toBe(true);
    expect(acceptQuality(CHROME_ACCEPT, "text", "html")).toBe(1);
    expect(acceptQuality(CHROME_ACCEPT, "application", "json")).toBe(0.8);
  });

  test("missing, */*, and explicit JSON stay on the envelope", () => {
    expect(prefersHtml(null)).toBe(false);
    expect(prefersHtml("*/*")).toBe(false);
    expect(prefersHtml("application/json")).toBe(false);
    expect(prefersHtml("text/html, application/json")).toBe(false);
  });
});

describe("tokenizeJson", () => {
  test("marks keys, strings, numbers, and literals", () => {
    const kinds = tokenizeJson('{"ok":true,"n":1,"s":"x"}').map((t) => t.kind);
    expect(kinds).toContain("key");
    expect(kinds).toContain("literal");
    expect(kinds).toContain("number");
    expect(kinds).toContain("string");
  });

  test("prettyJson leaves invalid text alone", () => {
    expect(prettyJson("not-json")).toBe("not-json");
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
  });
});

describe("shouldRenderJsonCodeBlock", () => {
  test("only GET JSON that prefers HTML", () => {
    const json = new Response(JSON.stringify({ data: { ok: true }, error: null }), {
      headers: { "content-type": "application/json" },
    });
    expect(
      shouldRenderJsonCodeBlock(
        new Request("http://127.0.0.1:6530/", { headers: { accept: CHROME_ACCEPT } }),
        json,
      ),
    ).toBe(true);
    expect(shouldRenderJsonCodeBlock(new Request("http://127.0.0.1:6530/"), json)).toBe(false);
    expect(
      shouldRenderJsonCodeBlock(
        new Request("http://127.0.0.1:6530/?raw=1", { headers: { accept: CHROME_ACCEPT } }),
        json,
      ),
    ).toBe(true);
    expect(
      shouldRenderJsonCodeBlock(
        new Request("http://127.0.0.1:6530/?format=json", { headers: { accept: CHROME_ACCEPT } }),
        json,
      ),
    ).toBe(false);
    expect(
      shouldRenderJsonCodeBlock(
        new Request("http://127.0.0.1:6530/_/ready", { headers: { accept: CHROME_ACCEPT } }),
        json,
      ),
    ).toBe(false);
  });
});

describe("renderJsonCodeBlockHtml", () => {
  test("escapes a script breakout in JSON", () => {
    const html = renderJsonCodeBlockHtml({
      json: JSON.stringify({ data: { x: "</script><script>alert(1)</script>" }, error: null }),
      status: 200,
      method: "GET",
      path: "/",
      app: "keel",
      rawHref: "/?raw=1",
      prettyHref: "/",
    });
    expect(html).toContain('data-slot="json-code-block"');
    expect(html).toContain('class="strip"');
    expect(html).not.toContain("border-radius: 1rem");
    expect(html).toContain("GET /");
    expect(html).toContain("Ready");
    expect(html).not.toContain('data-slot="json-code-auth-switch"');
    expect(html).toContain('data-slot="json-code-view-toggle"');
    expect(html).toContain('href="/?raw=1"');
    expect(html).toContain(">Pretty</a>");
    expect(html).not.toContain(">Raw</a>");
    expect(html).not.toContain(">Console</a>");
    expect(html).not.toContain("</script><script>alert(1)</script>");
    expect(html).toContain("&lt;/script&gt;");
  });

  test("escapeHtml covers markup", () => {
    expect(escapeHtml(`<&"`)).toBe("&lt;&amp;&quot;");
  });

  test("renders latency next to the status", () => {
    const html = renderJsonCodeBlockHtml({
      json: '{"ok":true}',
      status: 200,
      method: "GET",
      path: "/",
      app: "keel",
      rawHref: "/?raw=1",
      prettyHref: "/",
      latencyMs: 12,
    });
    expect(html).toContain('data-slot="json-code-latency"');
    expect(html).toContain('data-tone="good"');
    expect(html).toContain("lat-good");
    expect(html).toContain("12ms");
    expect(formatJsonCodeLatency(0.4)).toBe("400μs");
    expect(formatJsonCodeLatency(1500)).toBe("1.5s");
    expect(jsonCodeLatencyTone(0.4)).toBe("fast");
    expect(jsonCodeLatencyTone(23.4)).toBe("good");
    expect(jsonCodeLatencyTone(6_000)).toBe("critical");
    expect(html).toContain('data-slot="json-code-cache"');
    expect(html).toContain('data-cache="none"');
  });

  test("renders a cache hit mark", () => {
    const html = renderJsonCodeBlockHtml({
      json: '{"ok":true}',
      status: 200,
      method: "GET",
      path: "/",
      app: "keel",
      rawHref: "/?raw=1",
      prettyHref: "/",
      cache: "hit",
    });
    expect(html).toContain('data-cache="hit"');
    expect(html).toContain("cache-hit");
    expect(html).toContain("Cache hit");
    expect(html).toContain("Hit");
  });

  test("renders auth for the handled request", () => {
    expect(jsonCodeAuthFrom({ publicGate: true })).toEqual({ kind: "public" });
    expect(jsonCodeAuthFrom({ userId: "usr_1" })).toEqual({ kind: "user", id: "usr_1" });
    expect(jsonCodeAuthFrom({ apiKeyId: "key_1" })).toEqual({ kind: "key", id: "key_1" });
    expect(jsonCodeAuthFrom({})).toEqual({ kind: "none" });

    const publicHtml = renderJsonCodeBlockHtml({
      json: '{"ok":true}',
      status: 200,
      method: "GET",
      path: "/notes",
      app: "notes",
      rawHref: "/notes?raw=1",
      prettyHref: "/notes",
      auth: { kind: "public" },
    });
    expect(publicHtml).toContain('data-slot="json-code-auth"');
    expect(publicHtml).toContain('data-auth="public"');
    expect(publicHtml).toContain("intentionally unauthenticated");
    expect(publicHtml).not.toContain('data-slot="json-code-auth-switch"');
    expect(publicHtml).not.toContain("data-auth-default");
    expect(publicHtml).not.toContain("data-route-public");
    expect(publicHtml).not.toContain('data-slot="json-code-auth-global"');
    expect(publicHtml).not.toContain('data-rail-section="auth"');
    expect(publicHtml).not.toContain(">Inherit</button>");
    expect(publicHtml).not.toContain(">Custom</button>");
    expect(publicHtml).not.toContain("oke:json-code:bearer");
    expect(publicHtml).not.toContain("Authentication");

    const userHtml = renderJsonCodeBlockHtml({
      json: '{"ok":true}',
      status: 200,
      method: "GET",
      path: "/me",
      app: "notes",
      rawHref: "/me?raw=1",
      prettyHref: "/me",
      auth: { kind: "user", id: "usr_alice" },
    });
    expect(userHtml).toContain('data-auth="user"');
    expect(userHtml).toContain("usr_alice");
    expect(userHtml).toContain("Authenticated user · usr_alice");
    expect(userHtml).not.toContain('data-slot="json-code-auth-switch"');
    expect(userHtml).not.toContain('data-slot="json-code-api-key-global"');
    expect(userHtml).not.toContain('data-slot="json-code-api-key-route"');
    expect(userHtml).not.toContain('data-slot="json-code-auth-global"');
    expect(userHtml).not.toContain('data-rail-section="auth"');
    expect(userHtml).not.toContain("Authentication");
    expect(userHtml).not.toContain(">Console</a>");
  });

  test("Authentication interactive UI is gone", () => {
    const html = renderJsonCodeBlockHtml({
      json: '{"ok":true}',
      status: 200,
      method: "GET",
      path: "/",
      app: "keel",
      rawHref: "/?raw=1",
      prettyHref: "/",
      auth: { kind: "public" },
    });
    expect(html).not.toContain('data-slot="json-code-auth-switch"');
    expect(html).not.toContain(">Authentication</button>");
    expect(html).not.toContain("Global API Key");
    expect(html).not.toContain("Route API Key");
    expect(html).not.toContain('data-slot="json-code-api-key-apply-global"');
    expect(html).not.toContain('data-slot="json-code-api-key-apply-route"');
    expect(html).not.toContain('data-slot="json-code-auth-route-mode"');
    expect(html).not.toContain('data-slot="json-code-auth-inherit"');
    expect(html).not.toContain('data-rail-section="auth"');
    expect(html).not.toContain(">Inherit</button>");
    expect(html).not.toContain(">Custom</button>");
    expect(html).not.toContain("oke:json-code:bearer");
    expect(html).not.toContain("oke:json-code:bearer-route");
    expect(html).not.toContain("oke:json-code:auth-route-mode");
    expect(html).not.toContain("oke:json-code:auth-tone");
    expect(html).not.toContain("function resolveBearer");
    expect(html).not.toContain("function routeIsPublic");
    expect(html).not.toContain("function applyGlobalKey");
    expect(html).not.toContain("refreshAuthTone");
    expect(html).toContain('data-slot="json-code-send"');
    expect(html).toContain('data-kv="headers"');
    expect(html).toContain('aria-label="Request"');
    expect(html).not.toContain(":6533");
    expect(html).not.toContain(">Console</a>");
  });

  test("renders the Request rail with tabs and current GET on", () => {
    const html = renderJsonCodeBlockHtml({
      json: '{"ok":true}',
      status: 200,
      method: "GET",
      path: "/tasks",
      app: "keel",
      rawHref: "/tasks?raw=1",
      prettyHref: "/tasks",
      nav: [
        {
          name: "/",
          routes: [
            {
              method: "GET",
              path: "/",
              href: "/",
              current: false,
              paramNames: [],
            },
          ],
        },
        {
          name: "tasks",
          routes: [
            {
              method: "GET",
              path: "/tasks",
              href: "/tasks",
              current: true,
              paramNames: [],
            },
            {
              method: "POST",
              path: "/tasks",
              href: null,
              current: false,
              paramNames: [],
            },
            {
              method: "GET",
              path: "/tasks/:id",
              href: null,
              current: false,
              paramNames: ["id"],
            },
          ],
        },
      ],
    });
    expect(html).toContain('data-slot="json-code-nav-panel"');
    expect(html).not.toContain("data-route-public");
    expect(html).toContain('aria-label="Expand request"');
    expect(html).not.toContain('id="json-code-rail" checked');
    expect(html).toContain('aria-label="Request"');
    expect(html).toContain('data-rail-section="routes"');
    expect(html).toContain('class="rail-nav"');
    expect(html).toContain('data-slot="json-code-request-dock"');
    expect(html).toContain('data-slot="json-code-send"');
    expect(html).toContain('data-slot="json-code-reset"');
    expect(html).not.toContain('data-slot="json-code-dock-auth"');
    expect(html).toContain('data-rail-section="query"');
    expect(html).toContain(">Params</span>");
    expect(html).toContain('data-rail-section="body"');
    expect(html).toContain(">Body</span>");
    expect(html).toContain('data-slot="json-code-body-mode"');
    expect(html).toContain('data-mode="form"');
    expect(html).toContain('data-mode="json"');
    expect(html).toContain('data-slot="json-code-body-raw"');
    expect(html).toContain('data-slot="json-code-body-hi"');
    expect(html).toContain('data-kv="body"');
    expect(html).not.toContain('data-rail-section="auth"');
    expect(html).not.toContain('data-slot="json-code-auth-route-mode"');
    expect(html).not.toContain(">Inherit</button>");
    expect(html).not.toContain(">Custom</button>");
    expect(html).not.toContain('data-slot="json-code-auth-global"');
    expect(html).toContain('data-rail-section="cookies"');
    expect(html).toContain('data-rail-section="headers"');
    expect(html).toContain('data-rail-section="path"');
    expect(html.indexOf('data-rail-section="query"')).toBeLessThan(
      html.indexOf('data-rail-section="body"'),
    );
    expect(html.indexOf('data-rail-section="body"')).toBeLessThan(
      html.indexOf('data-rail-section="cookies"'),
    );
    expect(html).toContain('data-method="GET"');
    expect(html).toContain('data-method="POST"');
    expect(html).toContain('class="rail-acc"');
    expect(html).toContain('class="rail-dock"');
    expect(html).toContain(">Routes</p>");
    expect(html).toContain('data-kv="cookies"');
    expect(html).toContain('data-kv="headers"');
    expect(html).toContain('data-kv="query"');
    expect(html).toContain('data-kv="path"');
    expect(html).not.toContain("data-kv-apply=");
    expect(html).toContain('data-path="/tasks"');
    expect(html).toContain('href="/tasks"');
    expect(html).toContain('class="leaf is-on"');
    expect(html).toContain("POST");
    expect(html).toContain("/tasks/:id");
    expect(html).toContain('data-param-template="/tasks/:id"');
    expect(html).not.toContain('href="/tasks/:id"');
    expect(html).toContain("data-route-leaf");
    expect(html).toContain('data-route-options="1"');
    expect(html).toContain("function selectRouteLeaf");
    expect(html).toContain("a.leaf[data-route-leaf][href]");
    expect(html).toContain("oke:json-code:rail-section");
    expect(html).not.toContain("data-rail-tab=");
    expect(html).not.toContain('data-slot="json-code-auth-panel"');
    expect(html).not.toContain('data-rail-section="routes" open');
    expect(html).toContain("<details>");
  });
});

describe("path templates", () => {
  test("pathParamNames extracts :segments", () => {
    expect(pathParamNames("/notes/:id/archive")).toEqual(["id"]);
    expect(pathParamNames("/a/:x/b/:y")).toEqual(["x", "y"]);
    expect(pathParamNames("/tasks")).toEqual([]);
  });

  test("matchPathTemplate and fillPathTemplate round-trip", () => {
    expect(matchPathTemplate("/notes/:id", "/notes/abc")).toEqual({ id: "abc" });
    expect(matchPathTemplate("/notes/:id", "/notes/abc/extra")).toBeNull();
    expect(fillPathTemplate("/notes/:id", { id: "abc" })).toBe("/notes/abc");
    expect(fillPathTemplate("/notes/:id", { id: "" })).toBeNull();
    expect(fillPathTemplate("/notes/:id/x/:slug", { id: "1", slug: "hi there" })).toBe(
      "/notes/1/x/hi%20there",
    );
  });
});

describe("httpGetNavPaths", () => {
  test("keeps static GET paths and drops params and internals", () => {
    expect(
      httpGetNavPaths([
        { trigger: { kind: "http", method: "GET", path: "/" } },
        { trigger: { kind: "http", method: "GET", path: "/tasks" } },
        { trigger: { kind: "http", method: "GET", path: "/tasks/:id" } },
        { trigger: { kind: "http", method: "POST", path: "/tasks" } },
        { trigger: { kind: "http", method: "GET", path: "/_/ready" } },
        { trigger: { kind: "signal" } },
      ]),
    ).toEqual(["/", "/tasks"]);
  });

  test("httpNavGroups groups by first segment and keeps raw on static GET", () => {
    const groups = httpNavGroups(
      [
        { trigger: { kind: "http", method: "GET", path: "/" } },
        { trigger: { kind: "http", method: "GET", path: "/tasks" } },
        { trigger: { kind: "http", method: "GET", path: "/tasks/:id" } },
        { trigger: { kind: "http", method: "POST", path: "/tasks" } },
        { trigger: { kind: "http", method: "GET", path: "/me/tasks" } },
        { trigger: { kind: "http", method: "GET", path: "/_/ready" } },
        { trigger: { kind: "signal" } },
      ],
      new Request("http://127.0.0.1:6530/tasks?raw=1"),
    );
    expect(groups).toEqual([
      {
        name: "/",
        routes: [
          {
            method: "GET",
            path: "/",
            href: "/?raw=1",
            current: false,
            paramNames: [],
          },
        ],
      },
      {
        name: "me",
        routes: [
          {
            method: "GET",
            path: "/me/tasks",
            href: "/me/tasks?raw=1",
            current: false,
            paramNames: [],
          },
        ],
      },
      {
        name: "tasks",
        routes: [
          {
            method: "GET",
            path: "/tasks",
            href: "/tasks?raw=1",
            current: true,
            paramNames: [],
          },
          {
            method: "POST",
            path: "/tasks",
            href: null,
            current: false,
            paramNames: [],
          },
          {
            method: "GET",
            path: "/tasks/:id",
            href: null,
            current: false,
            paramNames: ["id"],
          },
        ],
      },
    ]);
  });
});

describe("asBrowserJsonCodeBlock — HTTP", () => {
  test("Chrome GET / becomes the code block; curl stays JSON", async () => {
    on(
      http.get("/").public(),
      flow("main.root", {
        do: () => ({ ok: true as const, app: "keel" }),
      }),
    );
    const app = oke({ autoBoot: false, name: "keel" });

    const browser = await app.fetch(
      new Request("http://127.0.0.1:6530/", { headers: { accept: CHROME_ACCEPT } }),
    );
    expect(browser.status).toBe(200);
    expect(browser.headers.get("content-type")).toContain("text/html");
    expect(browser.headers.get("vary")).toMatch(/Accept/i);
    const html = await browser.text();
    expect(html).toContain('data-slot="json-code-block"');
    expect(html).toContain("keel");
    expect(html).toContain("&quot;ok&quot;");
    expect(html).toContain('data-slot="json-code-nav-panel"');
    expect(html).toContain('aria-label="Request"');
    expect(html).toContain('href="/"');
    expect(html).toContain('data-slot="json-code-latency"');
    expect(html).toContain('data-slot="json-code-cache"');
    expect(html).toContain('data-cache="none"');
    expect(html).toContain('data-slot="json-code-auth"');
    expect(html).toContain('data-auth="public"');
    expect(html).not.toContain('data-slot="json-code-auth-switch"');
    expect(html).not.toContain("data-auth-default");
    expect(html).not.toContain(">Console</a>");
    expect(html).toMatch(/\d+(?:\.\d+)?(?:μs|ms|s)/);

    const curl = await app.fetch(new Request("http://127.0.0.1:6530/"));
    expect(curl.headers.get("content-type")).toContain("application/json");
    expect(await curl.json()).toEqual({ data: { ok: true, app: "keel" }, error: null });
  });

  test("?raw=1 stays on the traces page; format=json and Accept stay the envelope", async () => {
    on(http.get("/health").public(), flow("main.health", { do: () => ({ ok: true as const }) }));
    const app = oke({ autoBoot: false, name: "keel" });

    const raw = await app.fetch(
      new Request("http://127.0.0.1:6530/health?raw=1", { headers: { accept: CHROME_ACCEPT } }),
    );
    expect(raw.headers.get("content-type")).toContain("text/html");
    const html = await raw.text();
    expect(html).toContain('data-view="raw"');
    expect(html).toContain('data-slot="json-code-view-toggle"');
    expect(html).toContain('href="/health"');
    expect(html).toContain(">Raw</a>");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("&quot;ok&quot;:true");

    const forced = await app.fetch(
      new Request("http://127.0.0.1:6530/health?format=json", {
        headers: { accept: CHROME_ACCEPT },
      }),
    );
    expect(await forced.json()).toEqual({ data: { ok: true }, error: null });

    const json = await app.fetch(
      new Request("http://127.0.0.1:6530/health", { headers: { accept: "application/json" } }),
    );
    expect(await json.json()).toEqual({ data: { ok: true }, error: null });
  });

  test("GET /_/ready stays JSON even when Accept prefers HTML", async () => {
    const app = oke({ autoBoot: false, name: "keel" });
    const res = await app.fetch(
      new Request("http://127.0.0.1:6530/_/ready", { headers: { accept: CHROME_ACCEPT } }),
    );
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ ready: false, reason: "booting" });
  });

  test("console helper and raw href follow the request host", () => {
    const request = new Request("http://127.0.0.1:6530/tasks?x=1");
    expect(consoleUrlFromRequest(request)).toBe("http://127.0.0.1:6533");
    expect(rawHrefFromRequest(request)).toBe("/tasks?x=1&raw=1");
    expect(prettyHrefFromRequest(new Request("http://127.0.0.1:6530/tasks?x=1&raw=1"))).toBe(
      "/tasks?x=1",
    );
  });

  test("wrapper copies status and skips non-JSON", async () => {
    const htmlIn = new Response("<p>hi</p>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    const skipped = await asBrowserJsonCodeBlock(
      new Request("http://127.0.0.1:6530/", { headers: { accept: CHROME_ACCEPT } }),
      htmlIn,
      "keel",
    );
    expect(await skipped.text()).toBe("<p>hi</p>");

    const fail = new Response(JSON.stringify({ data: null, error: { code: "NotFound" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
    const page = await asBrowserJsonCodeBlock(
      new Request("http://127.0.0.1:6530/missing", { headers: { accept: CHROME_ACCEPT } }),
      fail,
      "keel",
    );
    expect(page.status).toBe(400);
    expect(await page.text()).toContain("400");
  });
});
