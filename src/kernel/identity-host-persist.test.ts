/**
 * Host identity durability — standalone `oke()` (no Console).
 *
 * Creates a user via the real `/auth/sign-up/email` path, stops, boots a fresh
 * app against the same SQL URL, and resolves the same user on `/auth/sign-in/email`.
 * Production uses postgres + `DATABASE_URL`; this suite uses file-backed
 * PGlite at that same URL so the restart is hermetic.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AUTH_TABLES } from "../auth/tables.ts";
import { gate } from "../elements/gate.ts";
import { resetStores, store } from "../elements/store/declare.ts";
import { oke } from "./app.ts";
import { resetFlowSeq } from "./flow.ts";
import { resetBindings } from "./on.ts";

const PEPPER = "oke-host-identity-persist-pepper";
const member = gate.policy("member", ({ auth }) => !!auth.verified);

function resetIsolated(): void {
  resetBindings();
  resetFlowSeq();
  resetStores();
}

afterEach(() => {
  resetIsolated();
});

describe("host identity persist via store.sql()", () => {
  test("standalone oke() persists users+credentials across restart; sign-in resolves on a fresh store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-host-identity-"));
    const sqlUrl = join(dir, "pgdata");
    const prevDb = process.env.DATABASE_URL;
    const prevPglite = process.env.OKE_PGLITE_URL;
    process.env.DATABASE_URL = sqlUrl;
    process.env.OKE_PGLITE_URL = sqlUrl;

    try {
      resetIsolated();
      const db1 = store.sql("app", { schema: {} });
      const first = oke({
        name: "host-identity-first",
        stores: [db1],
        gate: {
          auth: { secret: PEPPER, emailAndPassword: { enabled: true } },
          policies: [member],
        },
        env: "test",
        startScheduler: false,
      });
      await first.boot({ env: "test", startScheduler: false });

      const signUp = await first.fetch(
        new Request("http://localhost/auth/sign-up/email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "persist@example.com", password: "CorrectHorse1!" }),
        }),
      );
      expect(signUp.status).toBe(200);
      const signedUp = (await signUp.json()) as {
        data: { accessToken: string; userId: string };
      };
      expect(signedUp.data.userId).toBeTruthy();

      const firstStore = first.bootResult?.store;
      await first.stop();
      await firstStore?.close();

      resetIsolated();
      const db2 = store.sql("app", { schema: {} });
      const second = oke({
        name: "host-identity-second",
        stores: [db2],
        gate: {
          auth: { secret: PEPPER, emailAndPassword: { enabled: true } },
          policies: [member],
        },
        env: "test",
        startScheduler: false,
      });
      await second.boot({ env: "test", startScheduler: false });

      const signIn = await second.fetch(
        new Request("http://localhost/auth/sign-in/email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "persist@example.com", password: "CorrectHorse1!" }),
        }),
      );
      expect(signIn.status).toBe(200);
      const session = (await signIn.json()) as { data: { userId: string } };
      expect(session.data.userId).toBe(signedUp.data.userId);

      const conn = await second.bootResult?.store?.primarySql();
      const identities = await conn?.query(`SELECT id, email FROM ${AUTH_TABLES.identities}`);
      expect(identities?.some((r) => r.email === "persist@example.com")).toBe(true);
      const credentials = await conn?.query(
        `SELECT user_id, provider, provider_account_id FROM ${AUTH_TABLES.credentials}`,
      );
      expect(credentials?.some((r) => r.provider === "credential")).toBe(true);

      const secondStore = second.bootResult?.store;
      await second.stop();
      await secondStore?.close();
    } finally {
      if (prevDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevDb;
      if (prevPglite === undefined) delete process.env.OKE_PGLITE_URL;
      else process.env.OKE_PGLITE_URL = prevPglite;
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
