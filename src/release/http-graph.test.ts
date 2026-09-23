/**
 * `okengine/http` must not statically import heavy modules.
 * Forbidden ids live in {@link HTTP_STATIC_GRAPH_FORBIDDEN}.
 */

import { describe, expect, test } from "bun:test";
import { forbiddenHttpGraphHits, readStaticGraphSpecifiers } from "./http-graph.ts";

describe("okengine/http static import graph", () => {
  test("zod and the hybrid-search runtime are not in the graph", async () => {
    const specifiers = await readStaticGraphSpecifiers();
    expect(specifiers.length).toBeGreaterThan(10);
    expect(forbiddenHttpGraphHits(specifiers)).toEqual([]);
  });

  test("the forbidden list matches zod and search-runtime, and nothing nearby", () => {
    expect(forbiddenHttpGraphHits(["node_modules/zod/index.js"])).toEqual(["zod"]);
    expect(forbiddenHttpGraphHits(["zod"])).toEqual(["zod"]);
    expect(forbiddenHttpGraphHits(["src/elements/store/search-runtime.ts"])).toEqual([
      "hybrid-search runtime",
    ]);
    expect(forbiddenHttpGraphHits(["src/elements/store/search-lsh.ts"])).toEqual([]);
    expect(forbiddenHttpGraphHits(["src/kernel/app.ts"])).toEqual([]);
  });
});
