/**
 * Supply-chain signals — honest N/A / unknown, never fabricated passes.
 */

import { describe, expect, test } from "bun:test";
import { projectSupplyChainSync } from "./supply-chain.ts";

describe("projectSupplyChainSync", () => {
  test("core gets not-applicable for registry-only checks", () => {
    const s = projectSupplyChainSync({
      origin: "core",
      packageName: null,
      cwd: process.cwd(),
      now: Date.now(),
      sources: [],
    });
    expect(s.lifecycleScripts.state).toBe("not-applicable");
    expect(s.releaseCooldown.state).toBe("not-applicable");
    expect(s.npmProvenance.state).toBe("not-applicable");
    expect(s.bootConflicts.state).toBe("clean");
  });

  test("community surfaces lifecycle fail and cooldown hold", () => {
    const now = 1_700_100_000_000;
    const s = projectSupplyChainSync({
      origin: "community",
      packageName: "oke-slack",
      cwd: process.cwd(),
      now,
      packageJson: {
        name: "oke-slack",
        scripts: { postinstall: "node evil.js" },
      },
      publishedAt: now - 60_000,
      provenance: "unknown",
      sources: [
        {
          path: "index.ts",
          source: `import fs from "node:fs";\n`,
        },
      ],
    });
    expect(s.lifecycleScripts.state).toBe("fail");
    expect(s.releaseCooldown.state).toBe("hold");
    expect(s.nodeImportScan.state).toBe("fail");
    expect(s.npmProvenance.state).toBe("unknown");
  });
});
