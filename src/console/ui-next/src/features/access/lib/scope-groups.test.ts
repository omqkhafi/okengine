import { describe, expect, test } from "bun:test";
import { groupAccessScopes } from "./scope-groups.ts";

describe("groupAccessScopes", () => {
  test("groups Module:Action by the first segment", () => {
    expect(
      groupAccessScopes([
        "booking:create",
        "comment:write",
        "member",
        "member:admin",
        "console:flows:invoke-as",
      ]),
    ).toEqual([
      { group: "booking", items: [{ scope: "booking:create", action: "create" }] },
      { group: "comment", items: [{ scope: "comment:write", action: "write" }] },
      {
        group: "member",
        items: [
          { scope: "member", action: "member" },
          { scope: "member:admin", action: "admin" },
        ],
      },
      {
        group: "console",
        items: [{ scope: "console:flows:invoke-as", action: "flows:invoke-as" }],
      },
    ]);
  });

  test("empty catalog", () => {
    expect(groupAccessScopes([])).toEqual([]);
  });
});
