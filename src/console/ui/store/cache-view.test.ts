import { describe, expect, test } from "bun:test";
import { explainCache } from "./cache-view.ts";
import { STORE_FIXTURE } from "./fixture.ts";

describe("explainCache", () => {
  test("surfaces produced-by-read and invalidators", () => {
    const child = STORE_FIXTURE[0]!.children[0]!;
    const expl = explainCache(child);
    expect(expl.producedByRead).toBe("computed:sql:bookings");
    expect(expl.invalidatedBy).toContain("sql:bookings");
    expect(expl.summary).toContain("computed:sql:bookings");
  });
});
