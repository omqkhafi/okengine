/**
 * Durable Console operators + sessions in Postgres schema `oke_console`
 * (PGlite under `.oke/console-pg` when no DATABASE_URL).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOperator } from "../../auth/operator.ts";
import { issueSession, verifyAccess } from "../../auth/sessions.ts";
import { AUTH_TABLES } from "../../auth/tables.ts";
import { connectPglite } from "../../drivers/pglite.ts";
import { bootConsoleApp, createConsoleApp } from "./app.ts";
import {
  CONSOLE_PG_SCHEMA,
  consoleTable,
  openConsolePersistence,
  resolveConsoleSecret,
} from "./operator-db.ts";

describe("console operator persistence", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  test("secret is stable across resolveConsoleSecret calls", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-secret-"));
    dirs.push(cwd);
    const a = await resolveConsoleSecret(cwd);
    const b = await resolveConsoleSecret(cwd);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(16);
  });

  test("claim persists and second boot skips claim print", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-ops-"));
    dirs.push(cwd);

    const first = await openConsolePersistence(cwd);
    expect(first.operators.operators.size).toBe(0);
    const op = await createOperator(first.operators, {
      email: "ops@example.com",
      name: "Ops",
      password: "password1234",
    });
    await first.persistOperator(op.id);
    await first.close();

    const second = await openConsolePersistence(cwd);
    expect(second.operators.operators.size).toBe(1);
    expect(second.operators.operators.get(op.id)?.email).toBe("ops@example.com");
    expect(second.operators.credentials.has(op.id)).toBe(true);

    const printed: string[] = [];
    const origLog = console.log;
    console.log = (line?: unknown) => {
      printed.push(String(line ?? ""));
    };
    try {
      const app = createConsoleApp({
        cwd,
        secret: second.secret,
        operators: second.operators,
        sessions: second.sessions,
        persistOperator: second.persistOperator,
        persistSessions: second.persistSessions,
        silentClaim: false,
      });
      expect(app.state.setupClosed).toBe(true);
      expect(printed.join("\n")).not.toContain("Claim code");
    } finally {
      console.log = origLog;
      await second.close();
    }
  });

  test("sessions survive reopen so access tokens still verify", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-sess-"));
    dirs.push(cwd);

    const first = await openConsolePersistence(cwd);
    const op = await createOperator(first.operators, {
      email: "ops@example.com",
      name: "Ops",
      password: "password1234",
    });
    await first.persistOperator(op.id);
    const issued = await issueSession(
      first.sessions,
      { secret: first.secret },
      { id: op.id, plane: "operator", scopes: ["console:*"] },
    );
    await first.persistSessions();
    await first.close();

    const second = await openConsolePersistence(cwd);
    expect(second.sessions.sessions.size).toBe(1);
    const claims = await verifyAccess(second.sessions, second.secret, issued.accessToken);
    expect(claims.sub).toBe(op.id);
    await second.close();
  });

  test("claim then reopen keeps session.me authorized", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-roundtrip-"));
    dirs.push(cwd);

    const firstPersist = await openConsolePersistence(cwd);
    const first = createConsoleApp({
      cwd,
      secret: firstPersist.secret,
      operators: firstPersist.operators,
      sessions: firstPersist.sessions,
      persistOperator: firstPersist.persistOperator,
      persistSessions: firstPersist.persistSessions,
      silentClaim: true,
    });
    await bootConsoleApp(first);
    let accessToken = "";
    try {
      const claimRes = await first.app.fetch(
        new Request("http://console.test/console/setup/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            claimCode: first.state.claim.code,
            email: "ops@example.com",
            name: "Ops",
            password: "password1234",
          }),
        }),
      );
      expect(claimRes.status).toBe(200);
      const body = (await claimRes.json()) as {
        data: { accessToken: string };
      };
      accessToken = body.data.accessToken;
    } finally {
      await first.app.stop();
      await firstPersist.close();
    }

    const secondPersist = await openConsolePersistence(cwd);
    const second = createConsoleApp({
      cwd,
      secret: secondPersist.secret,
      operators: secondPersist.operators,
      sessions: secondPersist.sessions,
      persistOperator: secondPersist.persistOperator,
      persistSessions: secondPersist.persistSessions,
      silentClaim: true,
    });
    await bootConsoleApp(second);
    try {
      const me = await second.app.fetch(
        new Request("http://console.test/console/session/me", {
          headers: { authorization: `Bearer ${accessToken}` },
        }),
      );
      expect(me.status).toBe(200);
      const meBody = (await me.json()) as {
        data: { email: string };
      };
      expect(meBody.data.email).toBe("ops@example.com");
    } finally {
      await second.app.stop();
      await secondPersist.close();
    }
  });

  test("stale Bearer on setup.status does not 401", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-stale-"));
    dirs.push(cwd);
    const persistence = await openConsolePersistence(cwd);
    const op = await createOperator(persistence.operators, {
      email: "ops@example.com",
      name: "Ops",
      password: "password1234",
    });
    await persistence.persistOperator(op.id);

    const handle = createConsoleApp({
      cwd,
      secret: persistence.secret,
      operators: persistence.operators,
      // Empty sessions — token cannot verify; public flow must still succeed.
      persistOperator: persistence.persistOperator,
      persistSessions: persistence.persistSessions,
      silentClaim: true,
    });
    await bootConsoleApp(handle);
    try {
      const res = await handle.app.fetch(
        new Request("http://console.test/console/setup/status", {
          headers: { authorization: "Bearer totally-forged-token" },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: { setupClosed: boolean };
      };
      expect(body.data.setupClosed).toBe(true);
    } finally {
      await handle.app.stop();
      await persistence.close();
    }
  });

  test("tables live in oke_console schema, not public", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-console-schema-"));
    dirs.push(cwd);
    const shared = await connectPglite({
      url: `memory://console-schema-${crypto.randomUUID()}`,
    });
    const opened = await openConsolePersistence(cwd, { connection: shared });
    try {
      const op = await createOperator(opened.operators, {
        email: "schema@example.com",
        name: "Schema",
        password: "password1234",
      });
      await opened.persistOperator(op.id);

      const inConsole = await shared.query(
        `SELECT email FROM ${consoleTable(AUTH_TABLES.operators)} WHERE id = ?`,
        [op.id],
      );
      expect(inConsole[0]?.["email"]).toBe("schema@example.com");

      const schemas = await shared.query(
        `SELECT table_schema
         FROM information_schema.tables
         WHERE table_name = ?`,
        [AUTH_TABLES.operators],
      );
      expect(schemas.map((r) => r["table_schema"])).toEqual([CONSOLE_PG_SCHEMA]);
    } finally {
      // connection was injected — close the shared handle ourselves
      await shared.close();
    }
  }, 15_000);
});
