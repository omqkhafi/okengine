/**
 * `oke vault` builtin loop — init · status · seal/unseal · rotate · audit ·
 * backup/restore.
 *
 * Every case runs against a real PGlite instance shared across the
 * subcommands of one scenario, which is what a live vault looks like: each
 * `oke vault …` is a fresh process that must re-supply the master key.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectPglite } from "../drivers/pglite.ts";
import type { SqlConnection } from "../drivers/types.ts";
import {
  createBuiltinVaultAdapter,
  sqlConnectionAsExec,
  type BuiltinVaultAdapter,
} from "../elements/vault/builtin-adapter.ts";
import { vaultCli } from "./vault-cmd.ts";

/** A CLI bound to one in-memory vault, plus its captured stdout. */
interface Harness {
  readonly sql: SqlConnection;
  /** Run `oke vault <args>`; returns the exit code. */
  run(args: readonly string[]): Promise<number>;
  /** Everything written to stdout since the last {@link reset}. */
  output(): string;
  reset(): void;
  close(): Promise<void>;
}

/**
 * Open a CLI harness over a fresh PGlite instance.
 *
 * @param cwd - Project root for relative file arguments
 */
async function harness(cwd?: string): Promise<Harness> {
  const sql = await connectPglite({ url: "memory://vault-cli-test" });
  let captured = "";
  return {
    sql,
    run: (args) =>
      vaultCli(args, {
        sql,
        // Never inherit a real OKE_VAULT_MASTER_KEY from the developer's shell.
        env: {},
        ...(cwd === undefined ? {} : { cwd }),
        write: (text) => {
          captured += text;
        },
      }),
    output: () => captured,
    reset: () => {
      captured = "";
    },
    close: () => sql.close(),
  };
}

/**
 * Extract the base64 master key printed once by `init` / `rotate-master`.
 *
 * @param output - Captured stdout
 */
function masterKeyFrom(output: string): string {
  const match = /shown once[^\n]*\n {2}(\S+)\n/.exec(output);
  if (!match?.[1]) throw new Error(`no master key in output:\n${output}`);
  return match[1];
}

/**
 * Attach a direct adapter to the harness connection (test-side seeding).
 *
 * @param sql - Shared connection
 * @param masterKey - Base64 master key
 */
async function attach(sql: SqlConnection, masterKey: string): Promise<BuiltinVaultAdapter> {
  const adapter = createBuiltinVaultAdapter({ db: sqlConnectionAsExec(sql) });
  await adapter.unseal(masterKey);
  return adapter;
}

describe("oke vault — builtin lifecycle", () => {
  test("init prints the master key once and status reflects seal state", async () => {
    const h = await harness();
    try {
      // A never-initialized vault reports rather than crashes.
      expect(await h.run(["status"])).toBe(0);
      expect(h.output()).toMatch(/initialized\s+no/);
      expect(h.output()).toContain("oke vault init");

      h.reset();
      expect(await h.run(["init"])).toBe(0);
      const masterKey = masterKeyFrom(h.output());
      expect(h.output()).toContain("initialized (kek v1)");

      h.reset();
      expect(await h.run(["status", "--json"])).toBe(0);
      const sealed = JSON.parse(h.output()) as { initialized: boolean; sealed: boolean };
      expect(sealed.initialized).toBe(true);
      // No key in this invocation — the vault cannot be read.
      expect(sealed.sealed).toBe(true);

      h.reset();
      expect(await h.run(["status", "--json", "--key", masterKey])).toBe(0);
      const unsealed = JSON.parse(h.output()) as { sealed: boolean; kekVersion: number };
      expect(unsealed.sealed).toBe(false);
      expect(unsealed.kekVersion).toBe(1);

      h.reset();
      expect(await h.run(["status"])).toBe(0);
      expect(h.output()).toMatch(/initialized\s+yes/);

      // A second init must not silently re-key a live vault.
      expect(await h.run(["init"])).toBe(1);
    } finally {
      await h.close();
    }
  });

  test("unseal requires a key and seal records the transition", async () => {
    const h = await harness();
    try {
      await h.run(["init"]);
      const masterKey = masterKeyFrom(h.output());

      expect(await h.run(["unseal"])).toBe(1);
      expect(await h.run(["unseal", "--key", "not-a-real-key"])).toBe(1);

      h.reset();
      expect(await h.run(["unseal", `--key=${masterKey}`])).toBe(0);
      expect(h.output()).toContain("unsealed (kek v1");

      h.reset();
      expect(await h.run(["seal"])).toBe(0);
      expect(h.output()).toContain("sealed");

      h.reset();
      expect(await h.run(["status", "--json", "--key", masterKey])).toBe(0);
      const status = JSON.parse(h.output()) as { sealCount: number };
      expect(status.sealCount).toBe(1);
    } finally {
      await h.close();
    }
  });
});

describe("oke vault rotate", () => {
  test("rotate re-encrypts the current value under a new version", async () => {
    const h = await harness();
    try {
      await h.run(["init"]);
      const masterKey = masterKeyFrom(h.output());
      const adapter = await attach(h.sql, masterKey);
      await adapter.set("app/token", "s3cr3t");

      h.reset();
      expect(await h.run(["rotate", "app/token", "--key", masterKey])).toBe(0);
      expect(h.output()).toContain("rotated app/token → v2");
      // The value is never echoed back to the operator.
      expect(h.output()).not.toContain("s3cr3t");

      const rotated = await adapter.get("app/token");
      expect(rotated?.version).toBe(2);
      expect(rotated?.value).toBe("s3cr3t");

      h.reset();
      expect(await h.run(["rotate", "app/token", "next-value", "--key", masterKey])).toBe(0);
      expect((await adapter.get("app/token"))?.value).toBe("next-value");

      expect(await h.run(["rotate", "app/missing", "--key", masterKey])).toBe(1);
      expect(await h.run(["rotate", "--key", masterKey])).toBe(1);
      expect(await h.run(["rotate", "app/token"])).toBe(1);
    } finally {
      await h.close();
    }
  });

  test("rotate-master issues a new key and retires the old one", async () => {
    const h = await harness();
    try {
      await h.run(["init"]);
      const first = masterKeyFrom(h.output());
      const adapter = await attach(h.sql, first);
      await adapter.set("app/token", "s3cr3t");

      h.reset();
      expect(await h.run(["rotate-master", "--key", first])).toBe(0);
      expect(h.output()).toContain("master rotated → kek v2");
      const second = masterKeyFrom(h.output());
      expect(second).not.toBe(first);

      h.reset();
      expect(await h.run(["status", "--json", "--key", second])).toBe(0);
      const status = JSON.parse(h.output()) as { sealed: boolean; kekVersion: number };
      expect(status.sealed).toBe(false);
      expect(status.kekVersion).toBe(2);

      // The retired key no longer opens the vault.
      expect(await h.run(["unseal", "--key", first])).toBe(1);

      const reopened = await attach(h.sql, second);
      expect((await reopened.get("app/token"))?.value).toBe("s3cr3t");
    } finally {
      await h.close();
    }
  });
});

describe("oke vault audit", () => {
  test("lists rows, verifies the chain, and purges by date", async () => {
    const h = await harness();
    try {
      await h.run(["init"]);
      const masterKey = masterKeyFrom(h.output());
      const adapter = await attach(h.sql, masterKey);
      await adapter.set("app/token", "s3cr3t");

      h.reset();
      expect(await h.run(["audit"])).toBe(0);
      expect(h.output()).toContain("initialize");
      expect(h.output()).toContain("app/token");
      expect(h.output()).not.toContain("s3cr3t");

      h.reset();
      expect(await h.run(["audit", "--path", "app/token", "--json"])).toBe(0);
      const rows = JSON.parse(h.output()) as { path: string; action: string }[];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.path === "app/token")).toBe(true);

      h.reset();
      expect(await h.run(["audit", "verify"])).toBe(0);
      expect(h.output()).toContain("audit chain intact");

      h.reset();
      const future = new Date(Date.now() + 3_600_000).toISOString();
      expect(await h.run(["audit", "purge", "--before", future])).toBe(0);
      expect(h.output()).toContain("purged");

      h.reset();
      expect(await h.run(["audit"])).toBe(0);
      // `purge` itself is auditable, so the chain restarts rather than empties.
      expect(h.output()).toContain("purge");

      expect(await h.run(["audit", "purge"])).toBe(1);
      expect(await h.run(["audit", "purge", "--before", "not-a-date"])).toBe(1);
      expect(await h.run(["audit", "nonsense"])).toBe(1);
    } finally {
      await h.close();
    }
  });
});

describe("oke vault backup / restore", () => {
  test("round-trips every live secret through an encrypted bundle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-vault-cli-"));
    const h = await harness(dir);
    try {
      await h.run(["init"]);
      const masterKey = masterKeyFrom(h.output());
      const adapter = await attach(h.sql, masterKey);
      await adapter.set("app/token", "s3cr3t");
      await adapter.set("app/other", "another");

      h.reset();
      expect(await h.run(["backup", "vault.bundle", "--key", masterKey])).toBe(0);
      expect(h.output()).toContain("encrypted byte(s) to vault.bundle");

      const bundle = await Bun.file(join(dir, "vault.bundle")).text();
      expect(bundle.startsWith("oke-vault-backup-v1")).toBe(true);
      expect(bundle).not.toContain("s3cr3t");

      h.reset();
      expect(await h.run(["restore", "vault.bundle", "--key", masterKey])).toBe(0);
      expect(h.output()).toContain("2 live secret(s)");

      // Restore replays through the write path: same value, new version.
      const restored = await adapter.get("app/token");
      expect(restored?.value).toBe("s3cr3t");
      expect(restored?.version).toBe(2);

      expect(await h.run(["restore", "missing.bundle", "--key", masterKey])).toBe(1);
      expect(await h.run(["backup"])).toBe(1);
      expect(await h.run(["backup", "vault.bundle"])).toBe(1);
    } finally {
      await h.close();
    }
  });
});

describe("oke vault help", () => {
  test("covers both the env loop and the builtin loop", async () => {
    let out = "";
    const code = await vaultCli([], {
      env: {},
      write: (t) => {
        out += t;
      },
    });
    expect(code).toBe(1);
    for (const sub of [
      "set",
      "import",
      "init",
      "unseal",
      "rotate-master",
      "audit",
      "purge-expired",
      "restore",
    ]) {
      expect(out).toContain(`oke vault ${sub}`);
    }
    expect(out).toContain("OKE_VAULT_MASTER_KEY");
    expect(out).toContain("Never pass master keys as CLI arguments");
  });
});

describe("oke vault secure master-key input", () => {
  test("unseal accepts --key - via injected stdin", async () => {
    const h = await harness();
    try {
      await h.run(["init"]);
      const masterKey = masterKeyFrom(h.output());
      h.reset();
      const code = await vaultCli(["unseal", "--key", "-"], {
        sql: h.sql,
        env: {},
        readStdin: async () => masterKey,
        write: (t) => {
          /* capture unused */
          void t;
        },
      });
      expect(code).toBe(0);
    } finally {
      await h.close();
    }
  });

  test("unseal accepts an injected interactive prompt", async () => {
    const h = await harness();
    try {
      await h.run(["init"]);
      const masterKey = masterKeyFrom(h.output());
      h.reset();
      let prompted = "";
      const code = await vaultCli(["unseal"], {
        sql: h.sql,
        env: {},
        readSecret: async (prompt) => {
          prompted = prompt;
          return masterKey;
        },
        write: (t) => {
          void t;
        },
      });
      expect(code).toBe(0);
      expect(prompted).toContain("master key");
    } finally {
      await h.close();
    }
  });
});

describe("oke vault purge-expired", () => {
  test("dry-run counts without deleting; live purge removes expired rows", async () => {
    const h = await harness();
    try {
      await h.run(["init"]);
      const masterKey = masterKeyFrom(h.output());
      const adapter = await attach(h.sql, masterKey);
      await adapter.set("app/live", "keep");
      await adapter.set("app/stale", "gone", { expiresAt: new Date(Date.now() - 1_000) });

      h.reset();
      expect(await h.run(["purge-expired", "--dry-run", "--key", masterKey])).toBe(0);
      expect(h.output()).toContain("would purge 1 expired");

      const stillThere = (await h.sql.query(
        `SELECT COUNT(*)::text AS n FROM oke_vault_secrets WHERE path = $1`,
        ["app/stale"],
      )) as unknown as readonly { readonly n: string }[];
      expect(stillThere[0]?.n).toBe("1");

      h.reset();
      expect(await h.run(["purge-expired", "--key", masterKey])).toBe(0);
      expect(h.output()).toContain("purged 1 expired");

      const gone = (await h.sql.query(
        `SELECT COUNT(*)::text AS n FROM oke_vault_secrets WHERE path = $1`,
        ["app/stale"],
      )) as unknown as readonly { readonly n: string }[];
      expect(gone[0]?.n).toBe("0");
      expect((await adapter.get("app/live"))?.value).toBe("keep");
    } finally {
      await h.close();
    }
  });
});
