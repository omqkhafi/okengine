/**
 * Console Vault HTTP — audit verify + rotate-master (lease, continue, overlap).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createOperator } from "../../auth/operator.ts";
import { issueSession } from "../../auth/index.ts";
import { connectPglite } from "../../drivers/pglite.ts";
import {
  createBuiltinVaultAdapter,
  sqlConnectionAsExec,
} from "../../elements/vault/builtin-adapter.ts";
import type { Manifest } from "../../manifest/types.ts";
import { startConsoleApp, type ConsoleAppHandle } from "./serve.ts";

/** Repo `okengine/config` — absolute import so a temp `oke.config.ts` needs no install. */
const CONFIG_MOD = resolve(import.meta.dir, "../../config/index.ts");

const PASSWORD = "Password1234!";

type Json = {
  data?: Record<string, unknown> | null;
  error?: { code: string; data?: { reason?: string; phrase?: string } } | null;
};

async function claimOperator(
  handle: ConsoleAppHandle,
  email: string,
  name: string,
): Promise<{ token: string; operatorId: string }> {
  const res = await handle.app.fetch(
    new Request("http://console.test/console/setup/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        claimCode: handle.state.claim.code,
        email,
        name,
        password: PASSWORD,
      }),
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { accessToken: string; operatorId: string } };
  return { token: body.data.accessToken, operatorId: body.data.operatorId };
}

async function secondOperator(
  handle: ConsoleAppHandle,
  email: string,
  name: string,
): Promise<{ token: string; operatorId: string }> {
  const op = await createOperator(handle.state.operators, {
    email,
    name,
    password: PASSWORD,
  });
  const issued = await issueSession(
    handle.state.sessions,
    { secret: handle.state.secret, now: handle.state.now },
    { id: op.id, plane: "operator", scopes: [] },
  );
  return { token: issued.accessToken, operatorId: op.id };
}

function authHeaders(token: string): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
}

async function seedVault(datadir: string, secretCount: number, batchSize: number): Promise<string> {
  const conn = await connectPglite({ url: datadir });
  try {
    const adapter = createBuiltinVaultAdapter({
      db: sqlConnectionAsExec(conn),
      kekRewrapBatchSize: batchSize,
    });
    const init = await adapter.initialize();
    await adapter.unseal(init.masterKey);
    for (let i = 0; i < secretCount; i += 1) {
      await adapter.set(`prod/s/${i}`, `value-${i}`);
    }
    return init.masterKey;
  } finally {
    await conn.close();
  }
}

describe("console vault HTTP — audit verify", () => {
  let datadir: string;
  let masterKey: string;
  let handle: ConsoleAppHandle;
  let token: string;

  beforeAll(async () => {
    datadir = await mkdtemp(join(tmpdir(), "oke-console-vault-verify-"));
    masterKey = await seedVault(datadir, 2, 100);
    handle = await startConsoleApp({
      silentClaim: true,
      secret: "vault-http-verify",
      okeConfig: { drivers: { vault: { dev: "vault", test: "vault", prod: "vault" } } },
      vaultProcessEnv: {
        DATABASE_URL: datadir,
        OKE_VAULT_MASTER_KEY: masterKey,
      },
    });
    const claimed = await claimOperator(handle, "ops@example.com", "Ops");
    token = claimed.token;
  }, 30_000);

  afterAll(async () => {
    await handle.app.stop();
    await rm(datadir, { recursive: true, force: true });
  });

  test("intact chain returns ok with null brokenAt and row", async () => {
    const res = await handle.app.fetch(
      new Request("http://console.test/console/vault/audit/verify", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body.error).toBeFalsy();
    expect(body.data).toEqual({
      ok: true,
      brokenAt: null,
      reason: null,
      row: null,
    });
  });

  test("tampered row surfaces brokenAt + reason + row", async () => {
    const conn = await connectPglite({ url: datadir });
    try {
      const rows = await conn.query(`SELECT id FROM oke_vault_audit ORDER BY seq ASC`);
      const victim = typeof rows[1]?.id === "string" ? rows[1].id : undefined;
      expect(victim).toBeDefined();
      await conn.exec(`UPDATE oke_vault_audit SET action = 'delete' WHERE id = $1`, [victim]);
    } finally {
      await conn.close();
    }

    const res = await handle.app.fetch(
      new Request("http://console.test/console/vault/audit/verify", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body.error).toBeFalsy();
    expect(body.data?.ok).toBe(false);
    expect(typeof body.data?.brokenAt).toBe("string");
    expect(body.data?.reason).toBe("payload");
    const row = body.data?.row as { id: string } | null;
    expect(row?.id).toBe(typeof body.data?.brokenAt === "string" ? body.data.brokenAt : undefined);
  });
});

describe("console vault HTTP — rotate-master", () => {
  let datadir: string;
  let masterKey: string;
  let handle: ConsoleAppHandle;
  let tokenA: string;
  let tokenB: string;
  let hold: Promise<void>;
  let releaseHold: (() => void) | undefined;
  let enteredHold: (() => void) | undefined;

  beforeAll(async () => {
    datadir = await mkdtemp(join(tmpdir(), "oke-console-vault-rotate-"));
    masterKey = await seedVault(datadir, 10, 2);
    hold = Promise.resolve();
    handle = await startConsoleApp({
      silentClaim: true,
      secret: "vault-http-rotate",
      production: true,
      okeConfig: { drivers: { vault: { dev: "vault", test: "vault", prod: "vault" } } },
      vaultProcessEnv: {
        DATABASE_URL: datadir,
        OKE_VAULT_MASTER_KEY: masterKey,
      },
      vaultKekRewrapBatchSize: 2,
      rotateBatchHold: async () => {
        enteredHold?.();
        await hold;
      },
    });
    const a = await claimOperator(handle, "a@example.com", "Ops A");
    tokenA = a.token;
    const b = await secondOperator(handle, "b@example.com", "Ops B");
    tokenB = b.token;
  }, 30_000);

  afterAll(async () => {
    await handle.app.stop();
    await rm(datadir, { recursive: true, force: true });
  });

  test("missing confirm is ConfirmRequired ROTATE_MASTER", async () => {
    const res = await handle.app.fetch(
      new Request("http://console.test/console/vault/rotate-master", {
        method: "POST",
        headers: authHeaders(tokenA),
        body: JSON.stringify({}),
      }),
    );
    const body = (await res.json()) as Json;
    expect(body.error?.code).toBe("ConfirmRequired");
    expect(body.error?.data?.phrase).toBe("ROTATE_MASTER");
  });

  test("T1 start race: exactly one wins, loser is VaultRotateBusy", async () => {
    const body = JSON.stringify({
      confirmation: "ROTATE_MASTER",
      reason: "start race",
    });
    const [ra, rb] = await Promise.all([
      handle.app.fetch(
        new Request("http://console.test/console/vault/rotate-master", {
          method: "POST",
          headers: authHeaders(tokenA),
          body,
        }),
      ),
      handle.app.fetch(
        new Request("http://console.test/console/vault/rotate-master", {
          method: "POST",
          headers: authHeaders(tokenB),
          body,
        }),
      ),
    ]);
    const ba = (await ra.json()) as Json;
    const bb = (await rb.json()) as Json;
    const ok = [ba, bb].filter((x) => x.data?.ok === true);
    const busy = [ba, bb].filter((x) => x.error?.code === "VaultRotateBusy");
    expect(ok).toHaveLength(1);
    expect(busy).toHaveLength(1);
    expect(busy[0]?.error?.data?.reason ?? "").toMatch(/lease held|already in progress/i);
    expect(ok[0]?.data?.kekVersion).toBe(2);
    expect((ok[0]?.data?.remaining as number) > 0).toBe(true);
    const conn = await connectPglite({ url: datadir });
    try {
      const v2 = await conn.query(
        `SELECT COUNT(*)::text AS n FROM oke_vault_keys WHERE kek_version = 2`,
      );
      expect(Number(v2[0]?.n ?? 0)).toBeLessThanOrEqual(2);
    } finally {
      await conn.close();
    }
  });

  test("T2 cross-operator continue is system-level, not session-scoped", async () => {
    const res = await handle.app.fetch(
      new Request("http://console.test/console/vault/rotate-master", {
        method: "POST",
        headers: authHeaders(tokenB),
        body: JSON.stringify({
          confirmation: "ROTATE_MASTER",
          reason: "continue as B",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Json;
    expect(body.error).toBeFalsy();
    expect(body.data?.ok).toBe(true);
    expect(body.data?.kekVersion).toBe(2);
    expect(body.data?.masterKey).toBeNull();
    expect((body.data?.remaining as number) > 0).toBe(true);
    expect((body.data?.remaining as number) < 10).toBe(true);
  });

  test("T3 overlap while a batch is in-flight is busy, then B can continue", async () => {
    hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      enteredHold = resolve;
    });

    const aFetch = handle.app.fetch(
      new Request("http://console.test/console/vault/rotate-master", {
        method: "POST",
        headers: authHeaders(tokenA),
        body: JSON.stringify({
          confirmation: "ROTATE_MASTER",
          reason: "overlap A",
        }),
      }),
    );
    await entered;

    const bBusy = await handle.app.fetch(
      new Request("http://console.test/console/vault/rotate-master", {
        method: "POST",
        headers: authHeaders(tokenB),
        body: JSON.stringify({
          confirmation: "ROTATE_MASTER",
          reason: "overlap B",
        }),
      }),
    );
    const busyBody = (await bBusy.json()) as Json;
    expect(busyBody.error?.code).toBe("VaultRotateBusy");
    expect(busyBody.error?.data?.reason ?? "").toMatch(/already in progress/i);

    releaseHold?.();
    const aRes = await aFetch;
    const aBody = (await aRes.json()) as Json;
    expect(aBody.data?.ok === true || aBody.error?.code === "VaultRotateBusy").toBe(true);

    hold = Promise.resolve();
    enteredHold = undefined;
    const bContinue = await handle.app.fetch(
      new Request("http://console.test/console/vault/rotate-master", {
        method: "POST",
        headers: authHeaders(tokenB),
        body: JSON.stringify({
          confirmation: "ROTATE_MASTER",
          reason: "finish after overlap",
        }),
      }),
    );
    const cont = (await bContinue.json()) as Json;
    expect(cont.error).toBeFalsy();
    expect(cont.data?.ok).toBe(true);
    expect(cont.data?.kekVersion).toBe(2);
    expect(cont.data?.masterKey).toBeNull();
  });

  test("POST /console/vault/rotate still only rotates a value", async () => {
    const res = await handle.app.fetch(
      new Request("http://console.test/console/vault/rotate", {
        method: "POST",
        headers: authHeaders(tokenA),
        body: JSON.stringify({
          name: "missing",
          value: "x",
          confirmation: "ROTATE",
          reason: "not master",
        }),
      }),
    );
    const body = (await res.json()) as Json;
    expect(body.error?.code).toBe("VaultNotFound");
  });
});

describe("console vault HTTP — sealed rotate-master", () => {
  test("no master key is VaultSealed", async () => {
    const datadir = await mkdtemp(join(tmpdir(), "oke-console-vault-sealed-"));
    await seedVault(datadir, 1, 100);
    const handle = await startConsoleApp({
      silentClaim: true,
      secret: "vault-http-sealed",
      okeConfig: { drivers: { vault: { dev: "vault", test: "vault", prod: "vault" } } },
      vaultProcessEnv: { DATABASE_URL: datadir },
    });
    try {
      const { token } = await claimOperator(handle, "ops@example.com", "Ops");
      const res = await handle.app.fetch(
        new Request("http://console.test/console/vault/rotate-master", {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify({
            confirmation: "ROTATE_MASTER",
            reason: "sealed",
          }),
        }),
      );
      const body = (await res.json()) as Json;
      expect(body.error?.code).toBe("VaultSealed");
    } finally {
      await handle.app.stop();
      await rm(datadir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("console vault HTTP — set without a pre-bound runtime", () => {
  test("binds the env driver and writes the value", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-vault-set-"));
    const handle = await startConsoleApp({
      cwd,
      silentClaim: true,
      secret: "vault-http-set",
      manifest: {
        oke: "1.0",
        app: "keel",
        vault: {
          GITHUB_TOKEN: { description: "GitHub Issues sync token", rotate: "90d" },
        },
      } as Manifest,
    });
    try {
      expect(handle.state.vaultRuntime).toBeNull();
      const { token } = await claimOperator(handle, "ops@example.com", "Ops");
      const res = await handle.app.fetch(
        new Request("http://console.test/console/vault/set", {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify({
            name: "GITHUB_TOKEN",
            value: "ghp_dev_keel_github_sync",
            reason: "first",
          }),
        }),
      );
      const body = (await res.json()) as Json;
      expect(body.error).toBeFalsy();
      expect(body.data?.ok).toBe(true);
      expect(body.data?.name).toBe("GITHUB_TOKEN");
      expect(handle.state.vaultRuntime).toBeTruthy();
      const listed = await handle.state.listVault();
      expect(listed.backend?.driverId).toBe("env");
    } finally {
      await handle.app.stop();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("loads drivers.vault from oke.config.ts so the lock-path is built-in", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-vault-pin-"));
    await writeFile(
      join(cwd, "oke.config.ts"),
      `import { defineConfig } from ${JSON.stringify(CONFIG_MOD)};
export default defineConfig({ drivers: { vault: { dev: "vault" } } });
`,
    );
    const handle = await startConsoleApp({
      cwd,
      silentClaim: true,
      secret: "vault-http-pin",
      manifest: {
        oke: "1.0",
        app: "keel",
        vault: {
          GITHUB_TOKEN: { description: "GitHub Issues sync token", rotate: "90d" },
        },
      } as Manifest,
    });
    try {
      const listed = await handle.state.listVault();
      expect(listed.backend?.driverId).toBe("vault");
      expect(listed.backend?.builtin).toBe(true);
    } finally {
      await handle.app.stop();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
