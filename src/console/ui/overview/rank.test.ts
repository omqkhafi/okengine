/**
 * Ranked findings union — user harm → irreversibility → trend.
 */

import { describe, expect, test } from "bun:test";
import { buildCausalityGraph } from "../flows/graph.ts";
import { composeOverview } from "./compose.ts";
import {
  OVERVIEW_DAY_ONE_INPUTS,
  OVERVIEW_INPUTS_FIXTURE,
} from "./fixture.ts";
import { compareFindings, rankedFindings } from "./rank.ts";

describe("rankedFindings", () => {
  test("calls each panel source and ranks spam complaints first", () => {
    const view = composeOverview(OVERVIEW_INPUTS_FIXTURE);
    expect(view.findings.length).toBeGreaterThan(0);
    expect(view.findings[0]!.source).toBe("channels");
    expect(view.findings[0]!.title).toBe("Spam complaints");

    const sources = new Set(view.findings.map((f) => f.source));
    expect(sources.has("gates")).toBe(true);
    expect(sources.has("signals")).toBe(true);
    expect(sources.has("clock")).toBe(true);
    expect(sources.has("vault")).toBe(true);
    expect(sources.has("architecture")).toBe(true);
    expect(sources.has("plugins")).toBe(true);
    expect(sources.has("ai")).toBe(true);
    expect(sources.has("access")).toBe(true);
  });

  test("Access hygiene findings appear in the ranked union", () => {
    const view = composeOverview(OVERVIEW_INPUTS_FIXTURE);
    const access = view.findings.filter((f) => f.source === "access");
    expect(access.length).toBeGreaterThan(0);
    expect(access.some((f) => f.detail.includes("unused 90d"))).toBe(true);
    expect(access.some((f) => f.detail.includes("never signed in"))).toBe(true);
    expect(access.some((f) => f.detail.includes("expired invitation"))).toBe(
      true,
    );
    expect(access.every((f) => f.href === "/access")).toBe(true);
  });

  test("compareFindings orders by harm, then irreversibility, then trend", () => {
    const ordered = [
      {
        id: "a",
        source: "ai" as const,
        title: "a",
        detail: "",
        href: "/",
        userHarm: 10,
        irreversibility: 90,
        trend: 9,
      },
      {
        id: "b",
        source: "channels" as const,
        title: "b",
        detail: "",
        href: "/",
        userHarm: 100,
        irreversibility: 1,
        trend: 1,
      },
      {
        id: "c",
        source: "vault" as const,
        title: "c",
        detail: "",
        href: "/",
        userHarm: 10,
        irreversibility: 90,
        trend: 99,
      },
    ].sort(compareFindings);
    expect(ordered.map((f) => f.id)).toEqual(["b", "c", "a"]);
  });

  test("architecture cycles come from findCycles, not a static list", () => {
    const graph = buildCausalityGraph(OVERVIEW_INPUTS_FIXTURE.manifest!);
    const findings = rankedFindings({
      gatesAudit: {
        unguardedFlows: [],
        orphanPermissions: [],
        emptyRoles: [],
        unattachedGates: [],
      },
      signals: [],
      crons: [],
      vaultSecrets: [],
      channelOutcomes: [],
      architectureGraph: graph,
      diffChanges: [],
      aiVersions: [],
      accessHygiene: {
        unusedKeys: [],
        neverSignedInOperators: [],
        expiredInvitations: [],
      },
      now: OVERVIEW_INPUTS_FIXTURE.now,
    });
    expect(findings.some((f) => f.source === "architecture")).toBe(true);
    expect(findings.some((f) => f.detail.includes("Causal cycle"))).toBe(true);
  });
});

describe("composeOverview day-one", () => {
  test("shows findings + golden signals + busiest-flow invite", () => {
    const view = composeOverview(OVERVIEW_DAY_ONE_INPUTS);
    expect(view.hasDeclaredSlos).toBe(false);
    expect(view.slos).toEqual([]);
    expect(view.findings.length).toBeGreaterThan(0);
    expect(view.golden.sampleCount).toBeGreaterThan(0);
    expect(view.firstSloInvite).not.toBeNull();
    expect(view.firstSloInvite!.busiestFlow).toBe("bookings.create");
    expect(view.verdict.tone === "warn" || view.verdict.tone === "critical").toBe(
      true,
    );
    expect(view.verdict.line.length).toBeGreaterThan(0);
  });

  test("what changed is linked Diff summary, not recomputed", () => {
    const view = composeOverview(OVERVIEW_INPUTS_FIXTURE);
    expect(view.whatChanged.href).toBe("/diff");
    expect(view.whatChanged.line).toContain("Manifest change");
    expect(view.whatChanged.changeCount).toBeGreaterThan(0);
  });

  test("verdict names the burning objective in plain language", () => {
    const view = composeOverview(OVERVIEW_INPUTS_FIXTURE);
    expect(view.verdict.line).toMatch(/burning/i);
    expect(view.verdict.line).toContain("bookings.create");
    expect(view.verdict.line).toMatch(/exhaust/i);
  });
});
