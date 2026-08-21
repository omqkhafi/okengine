/**
 * Gate: the homepage snippet must track the standard starter's root Flow.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStarterFlowSnippet } from "./starter-flow.ts";

const STARTER_ROUTE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../packages/create-oke/templates/standard/src/flows/main/route.ts",
);

describe("loadStarterFlowSnippet", () => {
  test("reads the standard starter route.ts", () => {
    expect(existsSync(STARTER_ROUTE)).toBe(true);
    const snippet = loadStarterFlowSnippet();
    expect(snippet.startsWith("export const root = on(")).toBe(true);
    expect(snippet).toContain("http.get().public()");
    expect(snippet).toContain('app: "notes"');
    expect(snippet).not.toContain("export const health");
  });
});
