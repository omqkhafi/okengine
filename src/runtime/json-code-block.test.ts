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
  formatJsonCodeLatency,
  jsonCodeLatencyTone,
  httpGetNavPaths,
  httpNavGroups,
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
      consoleUrl: "http://127.0.0.1:6533",
      rawHref: "/?raw=1",
      prettyHref: "/",
    });
    expect(html).toContain('data-slot="json-code-block"');
    expect(html).toContain('class="strip"');
    expect(html).not.toContain("border-radius: 1rem");
    expect(html).toContain("GET /");
    expect(html).toContain("Ready");
    expect(html).toContain("http://127.0.0.1:6533");
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
      consoleUrl: "http://127.0.0.1:6533",
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
      consoleUrl: "http://127.0.0.1:6533",
      rawHref: "/?raw=1",
      prettyHref: "/",
      cache: "hit",
    });
    expect(html).toContain('data-cache="hit"');
    expect(html).toContain("cache-hit");
    expect(html).toContain("Cache hit");
    expect(html).toContain("Hit");
  });

  test("renders the Routes rail with the current GET on", () => {
    const html = renderJsonCodeBlockHtml({
      json: '{"ok":true}',
      status: 200,
      method: "GET",
      path: "/tasks",
      app: "keel",
      consoleUrl: "http://127.0.0.1:6533",
      rawHref: "/tasks?raw=1",
      prettyHref: "/tasks",
      nav: [
        {
          name: "/",
          routes: [{ method: "GET", path: "/", href: "/", current: false }],
        },
        {
          name: "tasks",
          routes: [
            { method: "GET", path: "/tasks", href: "/tasks", current: true },
            { method: "POST", path: "/tasks", href: null, current: false },
            { method: "GET", path: "/tasks/:id", href: null, current: false },
          ],
        },
      ],
    });
    expect(html).toContain('data-slot="json-code-nav-panel"');
    expect(html).toContain('aria-label="Expand routes"');
    expect(html).not.toContain('id="json-code-rail" checked');
    expect(html).toContain('aria-label="Routes"');
    expect(html).toContain('href="/tasks"');
    expect(html).toContain('class="leaf is-on"');
    expect(html).toContain("POST");
    expect(html).toContain("/tasks/:id");
    expect(html).not.toContain('href="/tasks/:id"');
    expect(html.match(/<details open>/g)?.length).toBe(1);
    expect(html).toContain("<details>");
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
        routes: [{ method: "GET", path: "/", href: "/?raw=1", current: false }],
      },
      {
        name: "me",
        routes: [{ method: "GET", path: "/me/tasks", href: "/me/tasks?raw=1", current: false }],
      },
      {
        name: "tasks",
        routes: [
          { method: "GET", path: "/tasks", href: "/tasks?raw=1", current: true },
          { method: "POST", path: "/tasks", href: null, current: false },
          { method: "GET", path: "/tasks/:id", href: null, current: false },
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
    expect(html).toContain('aria-label="Routes"');
    expect(html).toContain('href="/"');
    expect(html).toContain('data-slot="json-code-latency"');
    expect(html).toContain('data-slot="json-code-cache"');
    expect(html).toContain('data-cache="none"');
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

  test("console and raw href follow the request host", () => {
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
