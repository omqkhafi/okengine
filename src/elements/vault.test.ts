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
    expect(a.sensitive).toBe(true);
    expect(a.name).toBe("STRIPE_KEY");
    expect(a.description).toBe("Payments gateway key");

    const b = vault.secret("DATABASE_URL", { dev: "postgres://local" });
    expect(b.name).toBe("DATABASE_URL");
    expect(b.dev).toBe("postgres://local");

    const cfg = vault.config("PUBLIC_APP_URL", { dev: "http://localhost" });
    expect(cfg.kind).toBe("config");
    expect(cfg.sensitive).toBe(false);

    const fromDocker = vault.fromDocker("store.sql");
    expect(fromDocker).toStartWith("__oke_from_docker__:");
    const c = vault.secret("DATABASE_URL", { dev: fromDocker });
    expect(c.dev).toBe(fromDocker);
  });

  test("fromDocker resolves via OKE_<ROLE>_URL without env-var names in the kernel", async () => {
    const prev = process.env.OKE_STORE_SQL_URL;
    process.env.OKE_STORE_SQL_URL = "postgres://oke:x@127.0.0.1:5432/oke";
    try {
      const runtime = createVaultRuntime({
        secrets: [vault.secret("DATABASE_URL", { dev: vault.fromDocker("store.sql") })],
        chain: [],
        allowDevFallbacks: true,
      });
      await runtime.boot();
      expect(runtime.read("DATABASE_URL")).toBe("postgres://oke:x@127.0.0.1:5432/oke");
    } finally {
      if (prev === undefined) delete process.env.OKE_STORE_SQL_URL;
      else process.env.OKE_STORE_SQL_URL = prev;
    }
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
      expect(boot.gaps.map((g) => g.name).sort()).toEqual(["DATABASE_URL", "STRIPE_KEY"]);
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
        {
          driver: memoryVaultDriver,
          source: "process.env",
          options: { secrets: { KEY: "from-a" } },
        },
        {
          driver: memoryVaultDriver,
          source: "driver",
          options: { secrets: { KEY: "from-b" } },
        },
      ],
    });
    await runtime.boot();
    expect(runtime.read("KEY")).toBe("from-a");
    expect(runtime.resolution("KEY")).toBe("process.env");
    const chain = runtime.resolutionChain("KEY");
    expect(chain.find((s) => s.source === "process.env")?.won).toBe(true);
    expect(chain.find((s) => s.source === "driver")?.present).toBe(true);
    expect(chain.find((s) => s.source === "driver")?.won).toBe(false);
  });

  test("env layer resolves process env", async () => {
    const runtime = createVaultRuntime({
      secrets: [vault("OKE_TEST_SECRET")],
      chain: [
        {
          driver: envVaultDriver,
          source: "process.env",
          options: { env: { OKE_TEST_SECRET: "from-env" } },
        },
      ],
    });
    await runtime.boot();
    expect(runtime.read("OKE_TEST_SECRET")).toBe("from-env");
    expect(runtime.resolution("OKE_TEST_SECRET")).toBe("process.env");
  });

  test("last-read timestamp updates on read", async () => {
    let now = 1000;
    const runtime = createVaultRuntime({
      secrets: [vault("KEY")],
      chain: [
        {
          driver: memoryVaultDriver,
          options: { secrets: { KEY: "v" } },
        },
      ],
      now: () => now,
    });
    await runtime.boot();
    expect(runtime.lastReadAt("KEY")).toBeUndefined();
    runtime.read("KEY");
    expect(runtime.lastReadAt("KEY")).toBe(1000);
    now = 2000;
    runtime.read("KEY");
    expect(runtime.lastReadAt("KEY")).toBe(2000);
  });

  test("config cleartext is exposed; secrets are not", async () => {
    const runtime = createVaultRuntime({
      secrets: [vault.secret("STRIPE_KEY"), vault.config("PUBLIC_URL")],
      chain: [
        {
          driver: memoryVaultDriver,
          options: {
            secrets: {
              STRIPE_KEY: "sk_secret",
              PUBLIC_URL: "https://example.com",
            },
          },
        },
      ],
    });
    await runtime.boot();
    expect(runtime.cleartext("STRIPE_KEY")).toBeUndefined();
    expect(runtime.cleartext("PUBLIC_URL")).toBe("https://example.com");
    expect(runtime.fingerprint("STRIPE_KEY")).toBeDefined();
    expect(runtime.fingerprint("PUBLIC_URL")).toBeUndefined();
  });
});

describe("redaction + fingerprints", () => {
  test("secret value never appears in fx.log even when passed explicitly", async () => {
    const secret = "sk_live_super_secret_value_do_not_leak";
    const runtime = createVaultRuntime({
      secrets: [vault("STRIPE_KEY")],
      chain: [{ driver: memoryVaultDriver, options: { secrets: { STRIPE_KEY: secret } } }],
    });
    await runtime.boot();

    const lines: Array<{ message: string; data?: Record<string, unknown> }> = [];
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
    const { json } = await buildSopsFixture({ STRIPE_KEY: "sk_sops_decrypted" }, recipient);

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
