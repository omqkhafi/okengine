import { describe, expect, test } from "bun:test";
import { VAULT_FIXTURE } from "./fixture.ts";
import { groupByKind, matchesQuery } from "./group.ts";

describe("groupByKind", () => {
  test("groups secrets and config", () => {
    const groups = groupByKind(VAULT_FIXTURE);
    expect(groups.map((g) => g.kind)).toEqual(["secret", "config"]);
    expect(groups[0]?.secrets[0]?.name).toBe("STRIPE_KEY");
    expect(groups[1]?.secrets[0]?.name).toBe("PUBLIC_APP_URL");
  });

  test("filters by query", () => {
    const groups = groupByKind(VAULT_FIXTURE, "public");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe("config");
  });
});

describe("matchesQuery", () => {
  test("matches name case-insensitively", () => {
    expect(matchesQuery(VAULT_FIXTURE[0]!, "stripe")).toBe(true);
    expect(matchesQuery(VAULT_FIXTURE[0]!, "nope")).toBe(false);
  });
});
