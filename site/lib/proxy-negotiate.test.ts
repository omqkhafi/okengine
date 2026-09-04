/**
 * Gate: proxy.ts is the request-time negotiation point and stamps Vary: Accept.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

describe("proxy.ts markdown negotiation", () => {
  test("negotiates with isMarkdownPreferred and sets Vary: Accept", async () => {
    const src = await Bun.file(join(ROOT, "proxy.ts")).text();
    expect(src).toContain("markdownNegotiation");
    expect(src).toContain("markdownTwinPath");
    expect(src).toContain('response.headers.set("Vary", "Accept")');
    expect(src).toContain("markdownNotFoundResponse");
    expect(src).toContain("isChromeInspectorProbe");
    expect(src).toContain("status: 204");
  });
});
