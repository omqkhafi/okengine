/**
 * Gate: Chrome / Cursor DevTools CDP probes are recognized and not handbook URLs.
 */

import { describe, expect, test } from "bun:test";
import { isChromeInspectorProbe } from "./chrome-inspector.ts";
import { isUnnegotiatedPath, markdownNegotiation } from "./markdown-negotiate.ts";

describe("isChromeInspectorProbe", () => {
  test("matches CDP discovery paths", () => {
    expect(isChromeInspectorProbe("GET", "/json/version")).toBe(true);
    expect(isChromeInspectorProbe("GET", "/json/list")).toBe(true);
    expect(isChromeInspectorProbe("GET", "/json")).toBe(true);
    expect(isChromeInspectorProbe("GET", "/json/")).toBe(true);
    expect(isChromeInspectorProbe("HEAD", "/json/version")).toBe(true);
  });

  test("leaves handbook and other methods alone", () => {
    expect(isChromeInspectorProbe("GET", "/")).toBe(false);
    expect(isChromeInspectorProbe("GET", "/docs")).toBe(false);
    expect(isChromeInspectorProbe("GET", "/jsonld")).toBe(false);
    expect(isChromeInspectorProbe("POST", "/json/version")).toBe(false);
  });
});

describe("markdown negotiation leaves CDP probes unnegotiated", () => {
  test("Accept: text/markdown does not 404 /json/version", () => {
    const request = new Request("https://oke.omqkhafi.dev/json/version", {
      headers: { Accept: "text/markdown" },
    });
    expect(isUnnegotiatedPath("/json/version")).toBe(true);
    expect(markdownNegotiation(request).kind).toBe("pass");
  });
});
