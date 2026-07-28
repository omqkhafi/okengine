import { describe, expect, test } from "bun:test";
import { STORE_FIXTURE } from "./fixture.ts";
import { groupByFacet } from "./group.ts";

describe("groupByFacet", () => {
  test("groups into sql / kv / files / index", () => {
    const groups = groupByFacet(STORE_FIXTURE);
    expect(groups.map((g) => g.facet)).toEqual(["sql", "kv", "files", "index"]);
  });

  test("filters by name", () => {
    const groups = groupByFacet(STORE_FIXTURE, "bookings");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.facet).toBe("sql");
  });
});
