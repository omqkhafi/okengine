/**
 * OpenBao bootstrap — material durability gates (`.oke/` ignore + real
 * `0600`, init-then-write-fail must not report success, initialized-without-
 * key fails loud).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertMode,
  ensureOpenBao,
  OpenBaoBootstrapError,
  OPENBAO_STATE_DIR_REL,
} from "./openbao-bootstrap.ts";

let dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "oke-openbao-boot-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  dirs = [];
});

/** Scripted fake OpenBao (seal-status → init → unseal → policy → token). */
function fakeOpenBao(calls: { url: string; method: string; body?: string }[]) {
  const routes: Record<string, () => Response> = {
    "GET /v1/sys/seal-status": () =>
      Response.json({ sealed: false, initialized: false, t: 1, n: 1, progress: 0 }),
    "POST /v1/sys/init": () =>
      Response.json({ keys: ["unseal-key-1"], keys_base64: ["dW5zZWFs"], root_token: "root-tok" }),
    "POST /v1/sys/unseal": () => Response.json({ sealed: false, t: 1, n: 1, progress: 0 }),
    "POST /v1/sys/mounts/secret": () => Response.json({}),
    "POST /v1/sys/policy/oke-app": () => new Response(null, { status: 204 }),
    "POST /v1/auth/token/create": () =>
      Response.json({ auth: { client_token: "app-tok", policies: ["oke-app"] } }),
  };
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
    const path = new URL(url).pathname;
    const handler = routes[`${method} ${path}`];
    if (!handler) return new Response("not found", { status: 404 });
    return handler();
  }) as typeof globalThis.fetch;
  return fetchFn;
}

describe("openbao bootstrap material gates", () => {
  test("`.oke/` is gitignored (check-ignore, not inference)", () => {
    const root = join(import.meta.dir, "../..");
    for (const p of [
      `${OPENBAO_STATE_DIR_REL}/unseal.key`,
      `${OPENBAO_STATE_DIR_REL}/root.token`,
    ]) {
      const proc = Bun.spawnSync(["git", "check-ignore", "-v", p], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(proc.exitCode).toBe(0);
      expect(proc.stdout.toString()).toContain(".gitignore");
    }
  });

  test("init writes 0600 files + 0700 dir (real mode) before success", async () => {
    const cwd = await tempDir();
    const calls: { url: string; method: string; body?: string }[] = [];
    const result = await ensureOpenBao({
      cwd,
      url: "http://127.0.0.1:8200",
      names: ["STRIPE_KEY", "DATABASE_URL"],
      fetch: fakeOpenBao(calls),
    });
    expect(result.initializedNow).toBe(true);
    expect(result.appToken).toBe("app-tok");

    const stateDir = join(cwd, OPENBAO_STATE_DIR_REL);
    expect(statSync(stateDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(stateDir, "unseal.key")).mode & 0o777).toBe(0o600);
    expect(statSync(join(stateDir, "root.token")).mode & 0o777).toBe(0o600);
    expect(statSync(join(stateDir, "app.token")).mode & 0o777).toBe(0o600);
    assertMode(join(stateDir, "unseal.key"), 0o600);

    // Policy is scoped to the two declared paths only.
    const policyCall = calls.find((c) => c.url.endsWith("/v1/sys/policy/oke-app"));
    expect(policyCall?.body).toContain("secret/data/STRIPE_KEY");
    expect(policyCall?.body).toContain("secret/data/DATABASE_URL");
    expect(policyCall?.body).not.toContain("secret/data/*");
  });

  test("post-init material write failure does NOT report success", async () => {
    const cwd = await tempDir();
    // Block the state dir with a *file* so mkdir/write fails after init.
    const blocker = join(cwd, ".oke");
    await Bun.write(blocker, "not-a-dir");

    const calls: { url: string; method: string; body?: string }[] = [];
    let failed: unknown;
    try {
      await ensureOpenBao({
        cwd,
        url: "http://127.0.0.1:8200",
        names: ["STRIPE_KEY"],
        fetch: fakeOpenBao(calls),
      });
    } catch (err) {
      failed = err;
    }
    expect(failed).toBeDefined();
    // init happened (vault now initialized server-side) but we never returned
    // success without durable material.
    expect(calls.some((c) => c.url.endsWith("/v1/sys/init"))).toBe(true);
    expect(calls.some((c) => c.url.endsWith("/v1/auth/token/create"))).toBe(false);
  });

  test("initialized but host unseal.key missing → loud permanent-loss error", async () => {
    const cwd = await tempDir();
    const calls: { url: string; method: string; body?: string }[] = [];
    const fetchFn = fakeOpenBao(calls);
    // Seal-status says initialized (data exists) but the host has no material.
    const initialized = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/sys/seal-status")) {
        return Response.json({ sealed: true, initialized: true });
      }
      return fetchFn(input as string, init);
    }) as typeof globalThis.fetch;

    let failed: unknown;
    try {
      await ensureOpenBao({ cwd, url: "http://127.0.0.1:8200", fetch: initialized });
    } catch (err) {
      failed = err;
    }
    expect(failed).toBeInstanceOf(OpenBaoBootstrapError);
    expect(String(failed)).toContain("unrecoverable");
  });
});
