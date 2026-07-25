import { describe, expect, test } from "bun:test";
import { allGrantable, visibleGrantableScopes } from "./grantable.ts";
import { ACCESS_LIST_FIXTURE } from "./fixture.ts";

describe("grantable scopes (UI)", () => {
  test("only server grantable scopes are visible — no cross-plane leak", () => {
    const user = ACCESS_LIST_FIXTURE.userPlane.grantableScopes;
    const ops = ACCESS_LIST_FIXTURE.operatorPlane.grantableScopes;
    expect(user.every((s) => !s.startsWith("console:"))).toBe(true);
    expect(ops.every((s) => s.startsWith("console:"))).toBe(true);
    expect(visibleGrantableScopes(user, ["member", "console:x"])).toEqual([
      "member",
    ]);
    expect(allGrantable(["member"], user)).toBe(true);
    expect(allGrantable(["console:store.sql:read"], user)).toBe(false);
  });
});
