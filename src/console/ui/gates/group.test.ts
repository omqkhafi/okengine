/**
 * Bidirectional grouping tests (console §9.7).
 */

import { describe, expect, test } from "bun:test";
import { GATES_LIST_FIXTURE } from "./fixture.ts";
import { groupFlows, groupPrincipals } from "./group.ts";

describe("groupPrincipals", () => {
  test("groups by kind and filters", () => {
    const groups = groupPrincipals(GATES_LIST_FIXTURE.principals);
    expect(groups.map((g) => g.id)).toEqual(["role", "key", "user"]);
    expect(groups[0]?.items.some((i) => i.label === "member")).toBe(true);

    const filtered = groupPrincipals(GATES_LIST_FIXTURE.principals, "demo");
    expect(filtered.some((g) => g.id === "key")).toBe(true);
    expect(filtered.some((g) => g.id === "role")).toBe(false);
  });
});

describe("groupFlows", () => {
  test("groups by plane; flags unguarded", () => {
    const groups = groupFlows(GATES_LIST_FIXTURE.flows);
    const user = groups.find((g) => g.id === "user");
    expect(user?.items.some((i) => i.flag === "unguarded")).toBe(true);
    expect(user?.items.find((i) => i.id === "bookings.create")?.meta).toContain(
      "member → booking:create",
    );
  });
});
