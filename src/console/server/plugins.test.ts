/**
 * Plugins panel projection (console §9.15).
 */

import { describe, expect, test } from "bun:test";
import type { Manifest } from "../../manifest/types.ts";
import {
  filterCapabilityDiffForPlugin,
  groupPluginChanges,
  PLUGIN_STATE_DERIVATION,
  projectPluginsList,
} from "./plugins.ts";

const NOW = 1_700_000_000_000;

const MANIFEST: Manifest = {
  oke: "1.0",
  app: "plugins-test",
  plugins: {
    auth: {
      origin: "core",
      version: "0.0.1",
      declares: ["table:oke_identities"],
      intercepts: ["onAuth"],
    },
    console: {
      origin: "core",
      version: "0.0.1",
      declares: ["consolePanel:overview"],
      intercepts: ["beforeHandle"],
    },
    audit: {
      origin: "local",
      version: "1.0.0",
      declares: ["consolePanel:audit"],
      intercepts: ["afterHandle"],
    },
    "oke-slack": {
      origin: "community",
      version: "2.0.0",
      declares: ["channel:slack"],
      intercepts: [],
    },
  },
};

describe("projectPluginsList", () => {
  test("CORE always listed; local/community only when plugged; config state for tenancy/privacy", async () => {
    const list = await projectPluginsList({
      manifest: MANIFEST,
      config: { tenancy: { isolation: "row" } },
      cwd: process.cwd(),
      now: () => NOW,
      resolveCapabilityDiff: false,
      syncSupplyChain: true,
      fetchNpm: false,
      capabilityDiffByPlugin: {
        audit: [
          {
            path: "/plugins/audit",
            category: "permission-widening",
            kind: "changed",
            summary: "plugin capabilities widened: afterHandle",
          },
        ],
      },
      packageJsonByPlugin: {
        "oke-slack": { name: "oke-slack", scripts: {} },
      },
      sourcesByPlugin: {
        "oke-slack": [],
      },
    });

    expect(list.stateDerivation).toBe(PLUGIN_STATE_DERIVATION);
    const byId = Object.fromEntries(list.plugins.map((p) => [p.id, p]));

    expect(byId.auth?.state).toBe("on");
    expect(byId.console?.state).toBe("on");
    expect(byId["rate-limit"]?.state).toBe("off");
    expect(byId.tenancy?.state).toBe("on"); // config.tenancy
    expect(byId.privacy?.state).toBe("off");

    expect(byId.audit?.origin).toBe("local");
    expect(byId["oke-slack"]?.origin).toBe("community");
    expect(byId["oke-slack"]?.installCommand).toBe("bun add oke-slack");
    expect(byId.auth?.installCommand).toBeNull();

    expect(byId.audit?.capabilityDiff[0]?.summary).toContain("widened");
    expect(byId.auth?.supplyChain.lifecycleScripts.state).toBe("not-applicable");
    expect(byId["oke-slack"]?.supplyChain.releaseCooldown.state).not.toBe(
      "not-applicable",
    );
  });

  test("privacy on from runs.redact", async () => {
    const list = await projectPluginsList({
      manifest: { oke: "1.0", app: "x" },
      config: { runs: { redact: { email: "7y" } } },
      cwd: process.cwd(),
      now: () => NOW,
      resolveCapabilityDiff: false,
      syncSupplyChain: true,
      fetchNpm: false,
    });
    expect(list.plugins.find((p) => p.id === "privacy")?.state).toBe("on");
  });
});

describe("capability diff filter", () => {
  test("groupPluginChanges and filter reuse diffManifest paths", () => {
    const grouped = groupPluginChanges([
      {
        path: "/plugins/audit",
        category: "permission-widening",
        kind: "changed",
        summary: "widened",
      },
      {
        path: "/flows/x",
        category: "no-impact",
        kind: "changed",
        summary: "other",
      },
    ]);
    expect(grouped.audit).toHaveLength(1);
    expect(
      filterCapabilityDiffForPlugin(grouped.audit!, "audit"),
    ).toHaveLength(1);
  });
});
