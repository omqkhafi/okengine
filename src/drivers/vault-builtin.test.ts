/**
 * `vault` driver — adapter wiring and the never-fail-boot degradation path.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectPglite } from "./pglite.ts";
import { builtinVaultDriver, openBuiltinVaultAdapter, VAULT_BAG_ADAPTER } from "./vault-builtin.ts";
import type { BuiltinVaultAdapter } from "../elements/vault/builtin-adapter.ts";

describe("builtin vault driver", () => {
  test("openBuiltinVaultAdapter unseals an injected connection", async () => {
    const connection = await connectPglite({ url: "memory://vault-driver-test" });
    try {
      const first = await openBuiltinVaultAdapter({ connection, env: {} });
      const init = await first.adapter.initialize();
      await first.adapter.unseal(init.masterKey);
      await first.adapter.set("prod/api/stripe", "sk_live_x");

      // A second open over the same connection unseals from the master key.
      const second = await openBuiltinVaultAdapter({
        connection,
        env: { OKE_VAULT_MASTER_KEY: init.masterKey },
      });
      expect(second.adapter.getUnsealer()).not.toBeNull();
      expect((await second.adapter.get("prod/api/stripe"))?.value).toBe("sk_live_x");
    } finally {
      await connection.close();
    }
  });

  test("open with no SQL configured degrades to the seed bag", async () => {
    const bag = await builtinVaultDriver.open({
      env: {},
      secrets: { APP_NAME: "demo" },
    });
    try {
      expect(bag.driverId).toBe("vault");
      expect(bag.get("APP_NAME")).toBe("demo");
      expect(bag.get("MISSING")).toBeUndefined();
      expect(bag.names()).toEqual(["APP_NAME"]);
    } finally {
      await bag.close?.();
    }
  });

  test("bag close auto-seals the adapter (SIGTERM → bootResult.close path)", async () => {
    const connection = await connectPglite({ url: "memory://vault-autoseal" });
    try {
      const staging = await openBuiltinVaultAdapter({ connection, env: {} });
      const init = await staging.adapter.initialize();
      await staging.adapter.unseal(init.masterKey);
      await staging.adapter.set("prod/api/stripe", "sk_live_z");
      await staging.adapter.seal();

      const bag = await builtinVaultDriver.open({
        connection,
        env: { OKE_VAULT_MASTER_KEY: init.masterKey },
      });
      const held = (bag as unknown as Record<symbol, BuiltinVaultAdapter | undefined>)[
        VAULT_BAG_ADAPTER
      ];
      expect(held).toBeDefined();
      expect(held!.getUnsealer()).not.toBeNull();
      expect(bag.get("prod/api/stripe")).toBe("sk_live_z");

      await bag.close?.();
      expect(held!.getUnsealer()).toBeNull();
      await expect(held!.get("prod/api/stripe")).rejects.toThrow(/sealed/i);
    } finally {
      await connection.close();
    }
  });

  test("open snapshots live secrets from an initialized vault", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-vault-driver-"));
    try {
      const staging = await connectPglite({ url: dir });
      const opened = await openBuiltinVaultAdapter({ connection: staging, env: {} });
      const init = await opened.adapter.initialize();
      await opened.adapter.unseal(init.masterKey);
      await opened.adapter.set("STRIPE_KEY", "sk_live_y");
      await staging.close();

      const bag = await builtinVaultDriver.open({
        url: dir,
        env: { OKE_VAULT_MASTER_KEY: init.masterKey },
      });
      try {
        expect(bag.names()).toEqual(["STRIPE_KEY"]);
        expect(bag.get("STRIPE_KEY")).toBe("sk_live_y");
      } finally {
        await bag.close?.();
      }

      // Without the master key the vault stays sealed and the bag is empty —
      // boot then reports ordinary gaps instead of a driver failure.
      const sealed = await builtinVaultDriver.open({ url: dir, env: {} });
      try {
        expect(sealed.names()).toEqual([]);
      } finally {
        await sealed.close?.();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
