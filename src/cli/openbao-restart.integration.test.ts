/**
 * Integration: real OpenBao survives a container restart with secrets intact.
 *
 * Proves the acceptance criterion — set a secret, kill/restart the container
 * on the same Raft volume, re-run the bootstrap unseal, and read the secret
 * back. Skips when no Docker daemon is available.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveInfrastructure, writeDerivedFiles } from "../docker/index.ts";
import { ensureOpenBao } from "./openbao-bootstrap.ts";

async function dockerAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["docker", "info"], { stdout: "pipe", stderr: "pipe" });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

async function compose(project: string, dir: string, args: readonly string[]): Promise<number> {
  const proc = Bun.spawn(["docker", "compose", "-p", project, ...args], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  return proc.exited;
}

describe("openbao restart persistence (real container)", () => {
  test("secret set before restart is readable after restart + unseal", async () => {
    if (!(await dockerAvailable())) {
      console.warn("skipping: docker daemon not available");
      return;
    }

    const dir = await mkdtemp(join(tmpdir(), "oke-openbao-it-"));
    const dockerDir = join(dir, "docker");
    const project = `oke-bao-${Date.now()}`;
    const composeFiles = ["compose.yml", "compose.vault.yml"];
    try {
      const derived = deriveInfrastructure({
        images: { vault: "openbao/openbao:2.6.1" },
        app: "baotest",
        includeApp: false,
        composeDir: "docker",
      });
      await writeDerivedFiles(derived, dockerDir, { writeStackEnv: true });
      const spec = derived.specs.find((s) => s.role === "vault")!;
      const url = `http://127.0.0.1:${spec.hostPort}`;

      const up = await compose(project, dockerDir, [
        ...composeFiles.flatMap((f) => ["-f", f]),
        "up",
        "-d",
      ]);
      expect(up).toBe(0);

      const names = ["STRIPE_KEY"];
      let first;
      try {
        first = await ensureOpenBao({ cwd: dir, url, names });
      } catch (err) {
        const logs = Bun.spawn(
          [
            "docker",
            "compose",
            "-p",
            project,
            ...composeFiles.flatMap((f) => ["-f", f]),
            "logs",
            "vault",
          ],
          { cwd: dockerDir, stdout: "pipe", stderr: "pipe" },
        );
        console.error(await new Response(logs.stdout).text());
        console.error(await new Response(logs.stderr).text());
        await logs.exited;
        throw err;
      }
      expect(first.appToken.length).toBeGreaterThan(0);

      const write = await fetch(`${url}/v1/secret/data/STRIPE_KEY`, {
        method: "POST",
        headers: { "X-Vault-Token": first.appToken, "content-type": "application/json" },
        body: JSON.stringify({ data: { value: "sk_restart_persistent" } }),
      });
      if (!write.ok) console.error("write failed", write.status, await write.text());
      expect(write.ok).toBe(true);

      // Kill + start the same volume (a real restart, not a fresh stack).
      const restart = await compose(project, dockerDir, [
        ...composeFiles.flatMap((f) => ["-f", f]),
        "restart",
      ]);
      expect(restart).toBe(0);
      // Poll the API until the server is back (sealed or unsealed).
      let apiUp = false;
      for (let i = 0; i < 60; i++) {
        try {
          const probe = await fetch(`${url}/v1/sys/seal-status`);
          if (probe.ok) {
            apiUp = true;
            break;
          }
        } catch {
          // not up yet
        }
        await Bun.sleep(500);
      }
      expect(apiUp).toBe(true);

      const second = await ensureOpenBao({ cwd: dir, url, names });
      expect(second.initializedNow).toBe(false);
      expect(second.appToken).toBe(first.appToken);

      const read = await fetch(`${url}/v1/secret/data/STRIPE_KEY`, {
        headers: { "X-Vault-Token": second.appToken },
      });
      expect(read.ok).toBe(true);
      const body = (await read.json()) as { data?: { data?: { value?: string } } };
      expect(body.data?.data?.value).toBe("sk_restart_persistent");
    } finally {
      await compose(project, dockerDir, [
        ...composeFiles.flatMap((f) => ["-f", f]),
        "down",
        "-v",
      ]).catch(() => 0);
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }, 180_000);
});
