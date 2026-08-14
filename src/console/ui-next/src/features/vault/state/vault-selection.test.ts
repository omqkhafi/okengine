import { describe, expect, test } from "bun:test";
import { validateVaultSearch } from "./vault-selection.ts";

describe("validateVaultSearch", () => {
  test("keeps q, name, and a known action", () => {
    expect(validateVaultSearch({ q: "stripe", name: "STRIPE_KEY", action: "rotate" })).toEqual({
      q: "stripe",
      name: "STRIPE_KEY",
      action: "rotate",
    });
    expect(validateVaultSearch({ action: "rotate-master" })).toEqual({
      action: "rotate-master",
    });
  });

  test("drops empty and unknown values", () => {
    expect(validateVaultSearch({ q: "", name: "", action: "wipe" })).toEqual({});
    expect(validateVaultSearch({})).toEqual({});
  });
});
