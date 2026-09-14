/**
 * Browser graph for `okengine/client-react` — Vite SPAs import `Can` from the
 * barrel, which also loads `useLiveQuery`.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

describe("client-react browser graph", () => {
  test("browser bundle does not pull node:async_hooks", async () => {
    const result = await Bun.build({
      entrypoints: [join(import.meta.dir, "index.ts")],
      target: "browser",
      format: "esm",
      minify: false,
      external: ["react", "react/jsx-runtime", "react-dom"],
    });
    expect(result.success).toBe(true);
    const text = (await Promise.all(result.outputs.map((output) => output.text()))).join("\n");
    expect(text).not.toContain("node:async_hooks");
    expect(text).not.toContain("realtime-bind");
  });
});
