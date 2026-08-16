/**
 * Keel vault seed — init the built-in store and write stub contracts.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBuiltinVaultAdapter } from "okengine/drivers";
import { KEEL_VAULT } from "@/core";
import { extraEnvSectionTitle } from "../../../scripts/reset.ts";
import { KEEL_VAULT_SEED, resolveKeelVaultSeedValues, seedKeelVault } from "./vault.ts";

const EXAMPLE = `# ── vault — built-in encrypted-at-rest store ────────────────
# OKE_VAULT_MASTER_KEY=
`;

describe("keel vault seed", () => {
  test("KEEL_VAULT_SEED is the static stubs — not fromDocker markers", () => {
    const named = KEEL_VAULT.filter(
      (c) => c.dev !== undefined && c.dev.length > 0 && !c.dev.startsWith("__oke_from_docker__:"),
    );
    expect(named).toHaveLength(17);
    for (const contract of named) {
      expect(KEEL_VAULT_SEED[contract.name]).toBe(contract.dev);
    }
    expect(KEEL_VAULT_SEED.GITHUB_TOKEN).toBe("ghp_dev_keel_github_sync");
    expect(KEEL_VAULT_SEED.PUBLIC_APP_URL).toBe("http://127.0.0.1:6530");
    expect(KEEL_VAULT_SEED.OKE_CONSOLE_SECRET).toBe("oke-dev-keel-console");
    expect(KEEL_VAULT_SEED.MEILI_MASTER_KEY).toBe("dev-keel-meili");
    expect(KEEL_VAULT_SEED.OPENAI_API_KEY).toBe("sk-dev-keel-openai-compatible");
    expect(KEEL_VAULT_SEED.DATABASE_URL).toBeUndefined();
    expect(KEEL_VAULT_SEED.OKE_AI_URL).toBeUndefined();
  });

  test("every contract except minted OKE_AI_URL has a `dev` fallback so seed can boot", () => {
    const missing = KEEL_VAULT.filter(
      (c) => c.name !== "OKE_AI_URL" && (c.dev === undefined || c.dev.length === 0),
    ).map((c) => c.name);
    expect(missing).toEqual([]);
  });

  test("resolveKeelVaultSeedValues copies minted stack URLs from env", () => {
    const values = resolveKeelVaultSeedValues({
      DATABASE_URL: "postgres://oke:x@127.0.0.1:6432/oke",
      OKE_AI_MODEL: "granite3.3:2b",
    });
    expect(values.DATABASE_URL).toBe("postgres://oke:x@127.0.0.1:6432/oke");
    expect(values.OKE_AI_MODEL).toBe("granite3.3:2b");
    expect(values.GITHUB_TOKEN).toBe("ghp_dev_keel_github_sync");
    expect(
      resolveKeelVaultSeedValues({ OKE_STORE_INDEX_KEY: "meili-from-compose" }).MEILI_MASTER_KEY,
    ).toBe("meili-from-compose");
  });

  test("extraEnvSectionTitle parks the master key under vault", () => {
    expect(extraEnvSectionTitle("OKE_VAULT_MASTER_KEY")).toContain("vault");
  });
});

describe("seedKeelVault", () => {
  test("initializes, writes stubs, persists the master key, and skips existing", async () => {
    const opened = await openBuiltinVaultAdapter({
      env: {},
      masterKey: "",
      url: "memory://oke-keel-vault-seed",
    });
    try {
      const root = await mkdtemp(join(tmpdir(), "oke-keel-vault-seed-"));
      await writeFile(join(root, ".env.example"), EXAMPLE, "utf8");
      const logs: string[] = [];
      const first = await seedKeelVault({
        root,
        opened,
        env: { DATABASE_URL: "postgres://oke:x@127.0.0.1:6432/oke" },
        write: (text) => logs.push(text),
      });
      expect(first.initialized).toBe(true);
      expect(first.written).toContain("GITHUB_TOKEN");
      expect(first.written).toContain("PUBLIC_APP_URL");
      expect(first.written).toContain("DATABASE_URL");
      expect((await opened.adapter.get("DATABASE_URL"))?.value).toBe(
        "postgres://oke:x@127.0.0.1:6432/oke",
      );
      expect((await opened.adapter.get("GITHUB_TOKEN"))?.value).toBe(KEEL_VAULT_SEED.GITHUB_TOKEN);
      expect((await opened.adapter.get("KEEL_WORKSPACE"))?.value).toBe("keel");
      const env = await readFile(join(root, ".env.local"), "utf8");
      expect(env).toContain("OKE_VAULT_MASTER_KEY=");
      expect(env).not.toContain("GITHUB_TOKEN=");
      expect(logs.some((line) => line.includes("initialized built-in vault"))).toBe(true);

      await opened.adapter.set("GITHUB_TOKEN", "already-set");
      const second = await seedKeelVault({
        root,
        opened,
        write: () => undefined,
      });
      expect(second.initialized).toBe(false);
      expect(second.skipped).toContain("GITHUB_TOKEN");
      expect(second.written).not.toContain("GITHUB_TOKEN");
      expect((await opened.adapter.get("GITHUB_TOKEN"))?.value).toBe("already-set");
    } finally {
      await opened.close();
    }
  }, 45_000);
});
