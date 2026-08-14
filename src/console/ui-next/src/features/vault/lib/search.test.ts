import { describe, expect, test } from "bun:test";
import { VAULT_FIXTURE } from "./fixture.ts";
import {
  applySearchSuggestion,
  formatVaultSearch,
  hasIsToken,
  matchesVaultSearch,
  parseVaultSearch,
  toggleIsToken,
  tokenizeVaultSearch,
  vaultSearchSuggestions,
} from "./search.ts";

const NOW = 1_700_000_000_000;

describe("parseVaultSearch", () => {
  test("empty query has no tokens", () => {
    expect(parseVaultSearch("").tokens).toEqual([]);
    expect(parseVaultSearch("   ").tokens).toEqual([]);
  });

  test("parses operators and free text", () => {
    const q = parseVaultSearch(
      "is:unset kind:secret from:.env.local reader:payments fp:sha256 stripe",
    );
    expect(q.tokens).toEqual([
      { kind: "is", value: "unset" },
      { kind: "kind", value: "secret" },
      { kind: "from", value: ".env.local" },
      { kind: "reader", value: "payments" },
      { kind: "fp", value: "sha256" },
      { kind: "text", value: "stripe" },
    ]);
  });

  test("rotate:due becomes is:overdue; quoted spans stay text", () => {
    const q = parseVaultSearch('rotate:due "GitHub Issues" has:readers');
    expect(q.tokens).toContainEqual({ kind: "is", value: "overdue" });
    expect(q.tokens).toContainEqual({ kind: "text", value: "GitHub Issues" });
    expect(q.tokens).toContainEqual({ kind: "has", value: "readers" });
  });

  test("unknown operators stay text", () => {
    expect(parseVaultSearch("foo:bar").tokens).toEqual([{ kind: "text", value: "foo:bar" }]);
  });
});

describe("matchesVaultSearch", () => {
  test("empty matches all", () => {
    expect(matchesVaultSearch(VAULT_FIXTURE[0]!, parseVaultSearch(""), NOW)).toBe(true);
  });

  test("text matches name, description, readers, and fingerprint", () => {
    expect(matchesVaultSearch(VAULT_FIXTURE[0]!, parseVaultSearch("stripe"), NOW)).toBe(true);
    expect(matchesVaultSearch(VAULT_FIXTURE[0]!, parseVaultSearch("payments.charge"), NOW)).toBe(
      true,
    );
    expect(matchesVaultSearch(VAULT_FIXTURE[0]!, parseVaultSearch("sha256:aaaa"), NOW)).toBe(true);
    expect(matchesVaultSearch(VAULT_FIXTURE[0]!, parseVaultSearch("nope"), NOW)).toBe(false);
  });

  test("is:blast and is:shared match the fixture secret", () => {
    expect(matchesVaultSearch(VAULT_FIXTURE[0]!, parseVaultSearch("is:blast"), NOW)).toBe(true);
    expect(matchesVaultSearch(VAULT_FIXTURE[0]!, parseVaultSearch("is:shared"), NOW)).toBe(true);
    expect(matchesVaultSearch(VAULT_FIXTURE[1]!, parseVaultSearch("is:blast"), NOW)).toBe(false);
  });

  test("kind:config and from:process.env match the fixture config", () => {
    expect(matchesVaultSearch(VAULT_FIXTURE[1]!, parseVaultSearch("kind:config"), NOW)).toBe(true);
    expect(matchesVaultSearch(VAULT_FIXTURE[1]!, parseVaultSearch("from:process.env"), NOW)).toBe(
      true,
    );
    expect(matchesVaultSearch(VAULT_FIXTURE[0]!, parseVaultSearch("kind:config"), NOW)).toBe(false);
  });

  test("operators AND together", () => {
    expect(
      matchesVaultSearch(VAULT_FIXTURE[0]!, parseVaultSearch("is:blast kind:secret"), NOW),
    ).toBe(true);
    expect(
      matchesVaultSearch(VAULT_FIXTURE[0]!, parseVaultSearch("is:blast kind:config"), NOW),
    ).toBe(false);
  });

  test("config cleartext is searchable; secret values are not in the row", () => {
    expect(matchesVaultSearch(VAULT_FIXTURE[1]!, parseVaultSearch("app.example"), NOW)).toBe(true);
  });

  test("does not search sensitive cleartext even if a row leaked one", () => {
    const leaked = { ...VAULT_FIXTURE[0]!, cleartext: "sk_live_DO_NOT_LEAK_fixture" };
    expect(matchesVaultSearch(leaked, parseVaultSearch("sk_live_DO_NOT_LEAK"), NOW)).toBe(false);
  });
});

describe("toggleIsToken", () => {
  test("adds and removes is:unset without dropping text", () => {
    expect(toggleIsToken("stripe", "unset")).toBe("is:unset stripe");
    expect(toggleIsToken("is:unset stripe", "unset")).toBe("stripe");
    expect(hasIsToken("is:unset stripe", "unset")).toBe(true);
  });
});

describe("formatVaultSearch", () => {
  test("round-trips operators then text", () => {
    const raw = "is:unset kind:secret stripe";
    expect(formatVaultSearch(parseVaultSearch(raw).tokens)).toBe(raw);
  });
});

describe("vaultSearchSuggestions", () => {
  test("empty query returns the catalog", () => {
    expect(vaultSearchSuggestions("", VAULT_FIXTURE).length).toBeGreaterThan(5);
  });

  test("is: prefix filters is: operators", () => {
    const hits = vaultSearchSuggestions("is:bl", VAULT_FIXTURE);
    expect(hits.some((h) => h.token === "is:blast")).toBe(true);
    expect(hits.every((h) => h.token.startsWith("is:"))).toBe(true);
  });

  test("reader: suggests flow ids", () => {
    const hits = vaultSearchSuggestions("reader:pay", VAULT_FIXTURE);
    expect(hits.map((h) => h.token)).toContain("reader:payments.charge");
  });
});

describe("applySearchSuggestion", () => {
  test("replaces the trailing token", () => {
    expect(applySearchSuggestion("is:un", "is:unset")).toBe("is:unset ");
    expect(applySearchSuggestion("stripe is:un", "is:unset")).toBe("stripe is:unset ");
    expect(applySearchSuggestion("stripe ", "is:blast")).toBe("stripe is:blast ");
  });
});

describe("tokenizeVaultSearch", () => {
  test("keeps quoted phrases", () => {
    expect(tokenizeVaultSearch('is:unset "GitHub Issues"')).toEqual(["is:unset", "GitHub Issues"]);
  });
});
