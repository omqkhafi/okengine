/**
 * Gate: scaffolded `standard` / `full` produce a Console projection with
 * non-empty rows for every touched element after a scripted first request.
 *
 * Opt-in via `CREATE_OKE_INTEGRATION=1` (same as other create-oke gates).
 *
 * The scripted request runs in a child process against the in-repo template
 * (avoids global `on()` registry cross-talk between standard and full).
 * Manifest / Console projection is asserted on a fresh scaffold tree.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { extractManifest } from "../../../src/compiler/extract.ts";
import { createManifestVaultRuntime } from "../../../src/console/server/vault.ts";
import { createConsoleState } from "../../../src/console/server/state.ts";
import {
  createVaultRuntime,
  defaultVaultResolutionChain,
  vault as declareVault,
} from "../../../src/elements/vault.ts";
import { scaffold } from "../src/scaffold.ts";
import { packageRoot, type TemplateId } from "../src/templates.ts";

const ENABLED = process.env["CREATE_OKE_INTEGRATION"] === "1";
const TIMEOUT_MS = 120_000;
const REPO_ROOT = resolve(packageRoot(), "../..");

/** Temp roots to clean in afterEach. */
const liveRoots: string[] = [];

describe.skipIf(!ENABLED)("create-oke Console projection (standard · full)", () => {
  afterEach(() => {
    while (liveRoots.length > 0) {
      const doomed = liveRoots.pop();
      if (doomed) rmSync(doomed, { recursive: true, force: true });
    }
  });

  test(
    "standard — first request → non-empty Console rows",
    async () => {
      await runScriptedRequest("standard");
      await assertConsoleProjection("standard");
    },
    TIMEOUT_MS,
  );

  test(
    "full — first request + AI → non-empty Console rows including AI",
    async () => {
      await runScriptedRequest("full");
      await assertConsoleProjection("full", { expectAi: true });
    },
    TIMEOUT_MS,
  );
});

/**
 * Exercise the ping chain (and AI echo for `full`) in an isolated process.
 *
 * @param id - Template id
 */
async function runScriptedRequest(id: TemplateId): Promise<void> {
  const createTestAppPath = join(REPO_ROOT, "src/test/create-test-app.ts");
  const appPath = join(REPO_ROOT, "templates", id, "src/app.ts");
  const echo =
    id === "full"
      ? `
    const echoed = await t.api.main.echo({ text: "hi" });
    if (echoed.error) throw new Error(JSON.stringify(echoed.error));
    if (!echoed.data?.ok) throw new Error("echo missing ok");
  `
      : "";

  const script = `
    import { createTestApp } from ${JSON.stringify(createTestAppPath)};
    import { app } from ${JSON.stringify(appPath)};
    const t = await createTestApp(app);
    try {
      const created = await t.api.main.create({ note: "hello" });
      if (created.error) throw new Error(JSON.stringify(created.error));
      if (!created.data?.id) throw new Error("create missing id");
      await t.signals.drain();
      ${echo}
    } finally {
      await t.close();
    }
  `;

  const proc = Bun.spawn(["bun", "-e", script], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    const out = await new Response(proc.stdout).text();
    throw new Error(`scripted ${id} request failed:\n${out}\n${err}`);
  }
}

/**
 * Scaffold and assert Console panel projections are non-empty.
 *
 * @param id - Template id
 * @param options - Whether AI panel must be non-empty
 */
async function assertConsoleProjection(
  id: TemplateId,
  options: { readonly expectAi?: boolean } = {},
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), `create-oke-proj-${id}-`));
  liveRoots.push(root);
  const targetDir = join(root, `${id}-app`);
  const scaffolded = scaffold({
    targetDir,
    name: `${id}-app`,
    source: { kind: "template", id },
  });

  // Zero-step Vault: scaffold copies `.env.example` → `.env.local`.
  expect(scaffolded.files).toContain(".env.local");
  expect(existsSync(join(targetDir, ".env.local"))).toBe(true);

  // Do not inject process.env — fingerprint must come from `.env.local`.
  const prevSecret = process.env["APP_SECRET"];
  delete process.env["APP_SECRET"];

  try {
    const chainSources = defaultVaultResolutionChain(targetDir).map(
      (l) => l.source,
    );
    expect(chainSources).toEqual([
      "process.env",
      ".env.local",
      ".env.docker",
      "driver",
    ]);

    const appRt = createVaultRuntime({
      secrets: [declareVault.secret("APP_SECRET")],
      chain: defaultVaultResolutionChain(targetDir),
      allowDevFallbacks: false,
    });
    await appRt.boot();

    const manifest = await extractManifest({ rootDir: targetDir });
    const consoleRt = await createManifestVaultRuntime(manifest, {
      cwd: targetDir,
      env: "local",
      allowDevFallbacks: false,
    });
    expect(consoleRt).not.toBeNull();
    expect(appRt.resolution("APP_SECRET")).toBe(".env.local");
    expect(consoleRt!.resolution("APP_SECRET")).toBe(".env.local");
    expect(consoleRt!.fingerprint("APP_SECRET")).toBe(
      appRt.fingerprint("APP_SECRET"),
    );

    const state = createConsoleState({
      silentClaim: true,
      secret: "oke-create-oke-projection-secret",
      cwd: targetDir,
      manifest,
      vaultEnv: "dev",
    });

    expect(Object.keys(manifest.flows ?? {}).length).toBeGreaterThan(0);

    const signals = await state.listSignals();
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.some((s) => s.name === "pinged")).toBe(true);

    const stores = await state.listStores();
    expect(stores.stores.length).toBeGreaterThan(0);
    expect(
      stores.stores.some((s) =>
        s.children.some(
          (c) => c.name === "pings" || c.effectRef.includes("pings"),
        ),
      ),
    ).toBe(true);

    const clocks = await state.listClocks();
    expect(clocks.crons.length).toBeGreaterThan(0);

    const gates = await state.listGates();
    expect(gates.gates.length).toBeGreaterThan(0);

    const vault = await state.listVault();
    expect(vault.secrets.length).toBeGreaterThan(0);
    const appSecret = vault.secrets.find((s) => s.name === "APP_SECRET");
    expect(appSecret).toBeDefined();
    expect(appSecret!.fingerprint).toBeTruthy();
    expect(appSecret!.winner).toBe(".env.local");
    // Console may append `dev-fallback` when allowDevFallbacks is on;
    // every canonical layer must still appear in order.
    expect(appSecret!.resolution.map((s) => s.source).slice(0, 4)).toEqual(
      chainSources,
    );

    const channels = await state.listChannels();
    expect(channels.templates.length).toBeGreaterThan(0);
    expect(channels.templates.some((c) => c.name === "ping-notice")).toBe(true);

    if (options.expectAi) {
      const ai = await state.listAi();
      expect(ai.prompts.length).toBeGreaterThan(0);
      expect(ai.prompts.some((p) => p.name === "echo")).toBe(true);
    }
  } finally {
    if (prevSecret === undefined) delete process.env["APP_SECRET"];
    else process.env["APP_SECRET"] = prevSecret;
  }
}
