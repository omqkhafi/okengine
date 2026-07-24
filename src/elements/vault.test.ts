/**
 * Vault element acceptance:
 * - a missing secret fails boot listing every gap
 * - a secret value never appears in a log or trace even when passed to fx.log
 * - fingerprints instead of values
 * - resolution chain (first hit wins)
 * - sops/age via Typage (in-process, no Go binary)
 */

import { describe, expect, test } from "bun:test";
import * as age from "age-encryption";
import {
  buildSopsFixture,
  envVaultDriver,
  memoryVaultDriver,
  sopsVaultDriver,
} from "../drivers/index.ts";
import { createFx } from "../kernel/fx.ts";
import {
  createVaultRuntime,
  fingerprintSecretSync,
  SECRET_MASK,
  vault,
  VaultBootError,
} from "./vault.ts";

describe("vault declaration", () => {
  test("vault() and vault.secret() shapes", () => {
    const a = vault("STRIPE_KEY", {
      description: "Payments gateway key",
      rotate: "90d",
    });
    expect(a.kind).toBe("secret");
    expect(a.name).toBe("STRIPE_KEY");
    expect(a.description).toBe("Payments gateway key");

    const b = vault.secret("DATABASE_URL", { dev: "postgres://local" });
    expect(b.name).toBe("DATABASE_URL");
    expect(b.dev).toBe("postgres://local");
  });
});

describe("boot lists every missing secret", () => {
  test("VaultBootError enumerates all gaps at once", async () => {
    const runtime = createVaultRuntime({
      secrets: [
        vault("STRIPE_KEY", { description: "Payments gateway key" }),
        vault("DATABASE_URL", { description: "Primary SQL URL" }),
        vault("PRESENT"),
      ],
      chain: [
        {
          driver: memoryVaultDriver,
          options: { secrets: { PRESENT: "yes" } },
        },
      ],
    });

    try {
      await runtime.boot();
      expect.unreachable("boot should fail");
    } catch (err) {
      expect(err).toBeInstanceOf(VaultBootError);
      const boot = err as VaultBootError;
      expect(boot.gaps).toHaveLength(2);
      expect(boot.gaps.map((g) => g.name).sort()).toEqual([
        "DATABASE_URL",
        "STRIPE_KEY",
      ]);
      expect(boot.message).toContain("STRIPE_KEY");
      expect(boot.message).toContain("Payments gateway key");
      expect(boot.message).toContain("DATABASE_URL");
      expect(boot.message).toContain("2 missing");
    }
  });

  test("dev fallbacks fill gaps when allowDevFallbacks", async () => {
    const runtime = createVaultRuntime({
      secrets: [vault("STRIPE_KEY", { dev: "sk_test_local" })],
      chain: [],
      allowDevFallbacks: true,
    });
    await runtime.boot();
    expect(runtime.read("STRIPE_KEY")).toBe("sk_test_local");
  });
});

describe("resolution chain", () => {
  test("first layer wins", async () => {
    const runtime = createVaultRuntime({
      secrets: [vault("KEY")],
      chain: [
        { driver: memoryVaultDriver, options: { secrets: { KEY: "from-a" } } },
        { driver: memoryVaultDriver, options: { secrets: { KEY: "from-b" } } },
      ],
    });
    await runtime.boot();
    expect(runtime.read("KEY")).toBe("from-a");
  });

  test("env layer resolves process env", async () => {
    const runtime = createVaultRuntime({
      secrets: [vault("OKE_TEST_SECRET")],
      chain: [
        {
          driver: envVaultDriver,
          options: { env: { OKE_TEST_SECRET: "from-env" } },
        },
      ],
    });
    await runtime.boot();
    expect(runtime.read("OKE_TEST_SECRET")).toBe("from-env");
  });
});

describe("redaction + fingerprints", () => {
  test("secret value never appears in fx.log even when passed explicitly", async () => {
    const secret = "sk_live_super_secret_value_do_not_leak";
    const runtime = createVaultRuntime({
      secrets: [vault("STRIPE_KEY")],
      chain: [
        { driver: memoryVaultDriver, options: { secrets: { STRIPE_KEY: secret } } },
      ],
    });
    await runtime.boot();

    const lines: Array<{ message: string; data?: Record<string, unknown> }> =
      [];
    const { fx } = createFxContextWithVault(runtime, lines);

    const value = fx.vault("STRIPE_KEY");
    expect(value).toBe(secret);

    fx.log.info(`charging with ${value}`, { key: value, nested: { k: value } });
    fx.log.error(secret, { stripe: secret });

    for (const line of lines) {
      expect(line.message).not.toContain(secret);
      expect(JSON.stringify(line.data ?? {})).not.toContain(secret);
      expect(line.message).toContain(SECRET_MASK);
    }
  });

  test("fingerprint is stable and not the value", async () => {
    const secret = "sk_test_abc";
    const runtime = createVaultRuntime({
      secrets: [vault("STRIPE_KEY")],
      chain: [
        {
          driver: memoryVaultDriver,
          options: { secrets: { STRIPE_KEY: secret } },
        },
      ],
    });
    await runtime.boot();
    const fp = runtime.fingerprint("STRIPE_KEY");
    expect(fp).toBe(fingerprintSecretSync(secret));
    expect(fp).not.toContain(secret);
    expect(fp?.startsWith("sha256:")).toBe(true);
  });
});

describe("sops / age (Typage)", () => {
  test("decrypts SOPS JSON in-process with age-encryption", async () => {
    const identity = await age.generateIdentity();
    const recipient = await age.identityToRecipient(identity);
    const { json } = await buildSopsFixture(
      { STRIPE_KEY: "sk_sops_decrypted" },
      recipient,
    );

    const runtime = createVaultRuntime({
      secrets: [vault("STRIPE_KEY")],
      chain: [
        {
          driver: sopsVaultDriver,
          options: { ciphertext: json, ageIdentity: identity },
        },
      ],
    });
    await runtime.boot();
    expect(runtime.read("STRIPE_KEY")).toBe("sk_sops_decrypted");
  });
});

/**
 * Helper — createFx with vault runtime + log sink.
 */
function createFxContextWithVault(
  vaultRuntime: Awaited<ReturnType<typeof createVaultRuntime>>,
  lines: Array<{ message: string; data?: Record<string, unknown> }>,
) {
  return {
    fx: createFx({
      flow: "payments.charge",
      effects: { secrets: ["STRIPE_KEY"] },
      vaultRuntime,
      onLog(level, message, data) {
        void level;
        lines.push({ message, data });
      },
    }),
  };
}
