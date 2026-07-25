/**
 * Durable Console operators under `.oke/console.sqlite`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOperator } from "../../auth/operator.ts";
import { createConsoleApp } from "./app.ts";
import {
  openConsolePersistence,
  resolveConsoleSecret,
} from "./operator-db.ts";

describe("console operator persistence", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
    );
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
      password: "password123",
    });
    first.persistOperator(op.id);
    first.close();

    const second = await openConsolePersistence(cwd);
    expect(second.operators.operators.size).toBe(1);
    expect(second.operators.operators.get(op.id)?.email).toBe(
      "ops@example.com",
    );
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
        persistOperator: second.persistOperator,
        silentClaim: false,
      });
      expect(app.state.setupClosed).toBe(true);
      expect(printed.join("\n")).not.toContain("Claim code");
    } finally {
      console.log = origLog;
      second.close();
    }
  });
});
