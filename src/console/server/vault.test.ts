/**
 * Console Vault projection — fingerprints only; resolution; blast radius.
 */

import { describe, expect, test } from "bun:test";
import { memoryVaultDriver } from "../../drivers/index.ts";
import {
  createVaultRuntime,
  fingerprintSecretSync,
  vault,
} from "../../elements/vault.ts";
import {
  createMemoryJournalStore,
  type JournalRun,
} from "../../kernel/journal.ts";
import type { Manifest } from "../../manifest/types.ts";
import {
  assertNoSecretLeak,
  blastRadiusOf,
  projectVaultList,
  readersOf,
  rotateVaultValue,
  setVaultValue,
} from "./vault.ts";

const SECRET = "sk_live_console_vault_test_do_not_leak";

function manifest(): Manifest {
  return {
    oke: "1.0",
    app: "vault-test",
    vault: {
      STRIPE_KEY: {
        description: "Payments",
        rotate: "90d",
      },
      PUBLIC_APP_URL: {
        description: "Public origin",
        sensitive: false,
      },
    },
    flows: {
      "payments.charge": {
        trigger: { http: { method: "POST", path: "/charge" } },
        effects: { secrets: ["STRIPE_KEY"] },
      },
      "site.render": {
        trigger: { http: { method: "GET", path: "/" } },
        effects: { secrets: ["PUBLIC_APP_URL"] },
      },
    },
  };
}

async function runtime() {
  const rt = createVaultRuntime({
    secrets: [
      vault.secret("STRIPE_KEY", { description: "Payments", rotate: "90d" }),
      vault.config("PUBLIC_APP_URL", { description: "Public origin" }),
    ],
    chain: [
      {
        driver: memoryVaultDriver,
        source: "driver",
        options: {
          secrets: {
            STRIPE_KEY: SECRET,
            PUBLIC_APP_URL: "https://app.example.com",
          },
        },
      },
    ],
    now: () => 1_700_000_000_000,
  });
  await rt.boot();
  return rt;
}

describe("projectVaultList", () => {
  test("secrets are fingerprinted; config is cleartext; never leaks secret", async () => {
    const rt = await runtime();
    const { secrets, env } = await projectVaultList({
      manifest: manifest(),
      runtime: rt,
      env: "dev",
      peerFingerprints: {
        STRIPE_KEY: { staging: fingerprintSecretSync(SECRET) },
      },
    });

    expect(env).toBe("dev");
    const stripe = secrets.find((s) => s.name === "STRIPE_KEY");
    const pub = secrets.find((s) => s.name === "PUBLIC_APP_URL");
    expect(stripe?.sensitive).toBe(true);
    expect(stripe?.fingerprint).toBe(fingerprintSecretSync(SECRET));
    expect(stripe?.cleartext).toBeNull();
    expect(stripe?.readers).toEqual(["payments.charge"]);
    expect(stripe?.sharedFingerprintEnvs).toContain("staging");
    expect(pub?.sensitive).toBe(false);
    expect(pub?.cleartext).toBe("https://app.example.com");
    expect(pub?.fingerprint).toBeNull();

    assertNoSecretLeak(stripe!, [SECRET]);
    assertNoSecretLeak(pub!, [SECRET]);
    expect(JSON.stringify(secrets)).not.toContain(SECRET);
  });

  test("resolution chain shows which layer won", async () => {
    const rt = createVaultRuntime({
      secrets: [vault.secret("KEY")],
      allowDevFallbacks: true,
      chain: [
        {
          driver: memoryVaultDriver,
          source: "process.env",
          options: { secrets: {} },
        },
        {
          driver: memoryVaultDriver,
          source: ".env.local",
          options: { secrets: { KEY: "from-local" } },
        },
        {
          driver: memoryVaultDriver,
          source: "driver",
          options: { secrets: { KEY: "from-driver" } },
        },
      ],
    });
    await rt.boot();
    const { secrets } = await projectVaultList({
      manifest: null,
      runtime: rt,
      env: "dev",
    });
    const row = secrets.find((s) => s.name === "KEY");
    expect(row?.winner).toBe(".env.local");
    expect(row?.resolution.find((s) => s.source === ".env.local")?.won).toBe(
      true,
    );
    expect(row?.resolution.find((s) => s.source === "driver")?.present).toBe(
      true,
    );
    expect(row?.resolution.find((s) => s.source === "driver")?.won).toBe(false);
  });

  test("last-read is recorded on runtime read", async () => {
    const rt = await runtime();
    expect(rt.lastReadAt("STRIPE_KEY")).toBeUndefined();
    rt.read("STRIPE_KEY");
    expect(rt.lastReadAt("STRIPE_KEY")).toBe(1_700_000_000_000);
    const { secrets } = await projectVaultList({
      manifest: manifest(),
      runtime: rt,
      env: "dev",
    });
    expect(secrets.find((s) => s.name === "STRIPE_KEY")?.lastReadAt).toBe(
      1_700_000_000_000,
    );
  });

  test("blast radius queries journal — count + longest wake", async () => {
    const readers = readersOf(manifest(), "STRIPE_KEY");
    const now = 1_000_000;
    const runs: JournalRun[] = [
      {
        id: "r1",
        flow: "payments.charge",
        input: {},
        status: "sleeping",
        entries: [],
        wakeAt: now + 5_000,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "r2",
        flow: "payments.charge",
        input: {},
        status: "sleeping",
        entries: [],
        wakeAt: now + 60_000,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "r3",
        flow: "site.render",
        input: {},
        status: "sleeping",
        entries: [],
        wakeAt: now + 999_999,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "r4",
        flow: "payments.charge",
        input: {},
        status: "completed",
        entries: [],
        createdAt: now,
        updatedAt: now,
      },
    ];
    const blast = blastRadiusOf(runs, readers, now);
    expect(blast.count).toBe(2);
    expect(blast.longestWakeAt).toBe(now + 60_000);
    expect(blast.longestOutstandingMs).toBe(60_000);
    expect([...blast.runIds].sort()).toEqual(["r1", "r2"]);

    const journal = createMemoryJournalStore(runs);
    const rt = await runtime();
    const { secrets } = await projectVaultList({
      manifest: manifest(),
      runtime: rt,
      journal,
      env: "dev",
      now: () => now,
    });
    expect(secrets.find((s) => s.name === "STRIPE_KEY")?.blastRadius.count).toBe(
      2,
    );
  });
});

describe("set / rotate", () => {
  test("set updates fingerprint and never returns value", async () => {
    const rt = await runtime();
    const before = rt.fingerprint("STRIPE_KEY");
    const result = setVaultValue(rt, {
      name: "STRIPE_KEY",
      value: "sk_rotated_value_xyz",
    });
    expect(result.name).toBe("STRIPE_KEY");
    expect(result.fingerprint).not.toBe(before);
    expect(result.fingerprint).toBe(
      fingerprintSecretSync("sk_rotated_value_xyz"),
    );
    expect(JSON.stringify(result)).not.toContain("sk_rotated_value_xyz");
  });

  test("rotate is the same write path", async () => {
    const rt = await runtime();
    const result = rotateVaultValue(rt, {
      name: "STRIPE_KEY",
      value: "sk_new",
    });
    expect(result.fingerprint).toBe(fingerprintSecretSync("sk_new"));
  });
});
