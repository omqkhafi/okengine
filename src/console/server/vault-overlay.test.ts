/**
 * Console vault overlay — operator-declared contracts, never env dumps.
 */

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  isVaultContractName,
  loadVaultOverlay,
  upsertVaultOverlay,
  VAULT_OVERLAY_REL,
} from "./vault-overlay.ts";

describe("isVaultContractName", () => {
  test("accepts ENV keys and rejects junk", () => {
    expect(isVaultContractName("STRIPE_KEY")).toBe(true);
    expect(isVaultContractName("A")).toBe(true);
    expect(isVaultContractName("stripe_key")).toBe(false);
    expect(isVaultContractName("PATH")).toBe(true);
    expect(isVaultContractName("1BAD")).toBe(false);
    expect(isVaultContractName("")).toBe(false);
  });
});

describe("vault overlay file", () => {
  test("round-trips a contract and ignores invalid rows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-vault-overlay-"));
    await upsertVaultOverlay(dir, {
      name: "ISSUE_PEPPER",
      kind: "secret",
      description: "Id pepper",
      rotate: "never",
    });
    const loaded = await loadVaultOverlay(dir);
    expect(loaded).toEqual([
      {
        name: "ISSUE_PEPPER",
        kind: "secret",
        description: "Id pepper",
        rotate: "never",
      },
    ]);
    const raw = await readFile(join(dir, VAULT_OVERLAY_REL), "utf8");
    expect(raw).not.toContain("sk_");
    expect(await loadVaultOverlay(join(dir, "missing"))).toEqual([]);
  });
});
