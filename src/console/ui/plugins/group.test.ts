/**
 * Plugins grouping — origin × state dimensions.
 */

import { describe, expect, test } from "bun:test";
import { PLUGINS_LIST_FIXTURE } from "./fixture.ts";
import { groupPlugins } from "./group.ts";

describe("groupPlugins", () => {
  test("CORE always listed including off; local/community only when present", () => {
    const groups = groupPlugins(PLUGINS_LIST_FIXTURE.plugins, {});
    const core = groups.find((g) => g.id === "core");
    expect(core).toBeDefined();
    const ids = core!.items.map((p) => p.id);
    expect(ids).toContain("auth");
    expect(ids).toContain("rate-limit");
    expect(ids).toContain("tenancy");
    expect(ids).toContain("privacy");
    expect(core!.items.some((p) => p.id === "rate-limit" && p.state === "off")).toBe(
      true,
    );

    const local = groups.find((g) => g.id === "local");
    expect(local?.items.map((p) => p.id)).toEqual(["audit"]);
    const community = groups.find((g) => g.id === "community");
    expect(community?.items.map((p) => p.id)).toEqual(["oke-slack"]);
  });

  test("filters by origin and state", () => {
    const off = groupPlugins(PLUGINS_LIST_FIXTURE.plugins, { state: "off" });
    expect(off.every((g) => g.items.every((p) => p.state === "off"))).toBe(true);
    const community = groupPlugins(PLUGINS_LIST_FIXTURE.plugins, {
      origin: "community",
    });
    expect(community).toHaveLength(1);
    expect(community[0]!.id).toBe("community");
  });
});
