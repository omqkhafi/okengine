/**
 * Live Ollama round-trip — real prompt, real response, documented default model.
 *
 * Opt-in (never auto-pull a multi-GB model in ordinary `bun test`):
 * 1. `OKE_TEST_OLLAMA_URL` — point at any reachable Ollama
 * 2. Ollama already listening on `http://127.0.0.1:11434`
 * 3. `OKE_TEST_OLLAMA_DOCKER=1` — start `ollama/ollama` via the recipe and pull
 *    `qwen3.5:9b` (slow first run)
 *
 * Without one of those, the suite skips with a visible reason (never an empty pass).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveInfrastructure, writeDerivedFiles } from "../docker/index.ts";
import { ai } from "../elements/ai.ts";
import { bindAi } from "../kernel/boot-bind/ai.ts";
import { OLLAMA_DEFAULT_MODEL, openOllama } from "./ai-ollama.ts";

const OLLAMA_IMAGE = "ollama/ollama:latest";
const DEFAULT_LOCAL = "http://127.0.0.1:11434";
const ENV_URL = process.env.OKE_TEST_OLLAMA_URL?.trim();
const WANT_DOCKER = process.env.OKE_TEST_OLLAMA_DOCKER === "1";

function dockerAvailable(): boolean {
  try {
    return Bun.spawnSync(["docker", "info"], { stdout: "pipe", stderr: "pipe" }).exitCode === 0;
  } catch {
    return false;
  }
}

async function probeOllama(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1_500) });
    return res.ok;
  } catch {
    return false;
  }
}

const DOCKER = dockerAvailable();
const localUp = ENV_URL ? false : await probeOllama(DEFAULT_LOCAL);
const canLive = Boolean(ENV_URL) || localUp || (WANT_DOCKER && DOCKER);

if (!canLive) {
  const reasons: string[] = [];
  if (!ENV_URL) reasons.push("OKE_TEST_OLLAMA_URL not set");
  if (!localUp) reasons.push("no Ollama on :11434");
  if (!WANT_DOCKER) reasons.push("OKE_TEST_OLLAMA_DOCKER≠1");
  else if (!DOCKER) reasons.push("docker daemon not available");
  console.log(`skip: live ollama e2e (${reasons.join("; ")})`);
}
const live = canLive ? test : test.skip;

let cleanup: (() => Promise<void>) | undefined;

afterAll(async () => {
  if (cleanup) await cleanup();
});

async function waitForOllama(url: string, timeoutMs: number, requireModel: boolean): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/tags`);
      if (res.ok) {
        if (!requireModel) return;
        const body = (await res.json()) as { models?: readonly { name?: string }[] };
        const names = (body.models ?? []).map((m) => m.name ?? "");
        if (
          names.some((n) => n === OLLAMA_DEFAULT_MODEL || n.startsWith(`${OLLAMA_DEFAULT_MODEL}`))
        ) {
          return;
        }
      }
    } catch {
      // still starting
    }
    await Bun.sleep(1_000);
  }
  throw new Error(
    `ollama not ready at ${url} within ${timeoutMs}ms${
      requireModel ? ` (need model ${OLLAMA_DEFAULT_MODEL})` : ""
    }`,
  );
}

async function resolveLiveUrl(): Promise<{ url: string; model: string }> {
  if (ENV_URL) {
    await waitForOllama(ENV_URL, 30_000, false);
    return { url: ENV_URL, model: process.env.OKE_AI_MODEL?.trim() || OLLAMA_DEFAULT_MODEL };
  }

  if (localUp) {
    return { url: DEFAULT_LOCAL, model: process.env.OKE_AI_MODEL?.trim() || OLLAMA_DEFAULT_MODEL };
  }

  const dir = await mkdtemp(join(tmpdir(), "oke-ollama-"));
  const dockerDir = join(dir, "docker");
  const project = `oke-ollama-${Date.now()}`;
  const instanceId = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  const derived = deriveInfrastructure({
    images: { ai: OLLAMA_IMAGE },
    app: "ollama-e2e",
    host: "127.0.0.1",
    includeApp: false,
    composeDir: "docker",
    instanceId,
    controls: { OKE_AI_MODEL: OLLAMA_DEFAULT_MODEL },
  });
  await writeDerivedFiles(derived, dockerDir, { writeStackEnv: true });

  const composeFiles = ["compose.yml", "compose.ai.yml"];
  const up = Bun.spawn(
    ["docker", "compose", "-p", project, ...composeFiles.flatMap((f) => ["-f", f]), "up", "-d"],
    {
      cwd: dockerDir,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...derived.stackEnv, OKE_AI_MODEL: OLLAMA_DEFAULT_MODEL },
    },
  );
  const [upErr, upCode] = await Promise.all([new Response(up.stderr).text(), up.exited]);
  if (upCode !== 0) {
    await rm(dir, { recursive: true, force: true });
    throw new Error(`docker compose up failed: ${upErr}`);
  }

  const url = derived.stackEnv.OKE_AI_URL!;
  cleanup = async () => {
    const down = Bun.spawn(
      ["docker", "compose", "-p", project, ...composeFiles.flatMap((f) => ["-f", f]), "down", "-v"],
      { cwd: dockerDir, stdout: "pipe", stderr: "pipe" },
    );
    await down.exited;
    await rm(dir, { recursive: true, force: true });
  };

  // Model pull can take a long time on first run.
  await waitForOllama(url, 20 * 60_000, true);
  return { url, model: OLLAMA_DEFAULT_MODEL };
}

describe("ollama live — real completion", () => {
  live(
    "boots against a real Ollama, completes with a real model, returns a real response",
    async () => {
      const { url, model } = await resolveLiveUrl();
      const prevUrl = process.env.OKE_AI_URL;
      const prevModel = process.env.OKE_AI_MODEL;
      process.env.OKE_AI_URL = url;
      process.env.OKE_AI_MODEL = model;

      try {
        const smart = ai.model("smart", { provider: "ollama", model });
        const ping = smart.prompt("ollama-ping", { version: 1 });

        const runtime = bindAi(
          {
            config: { drivers: { ai: { local: "ollama", test: "ollama" } } },
            ai: { models: [smart], prompts: [ping] },
          },
          undefined,
          () => Date.now(),
          "local",
          false,
        );
        expect(runtime.prompts.has("ollama-ping")).toBe(true);

        const client = await openOllama({ baseUrl: url, model });
        const result = await client.complete({
          messages: [
            {
              role: "user",
              content: "Reply with exactly the single word: pong",
            },
          ],
          temperature: 0,
          maxTokens: 32,
        });

        expect(result.driverId).toBe("ollama");
        expect(result.text.trim().length).toBeGreaterThan(0);
        expect(result.text.toLowerCase()).toContain("pong");
      } finally {
        if (prevUrl === undefined) delete process.env.OKE_AI_URL;
        else process.env.OKE_AI_URL = prevUrl;
        if (prevModel === undefined) delete process.env.OKE_AI_MODEL;
        else process.env.OKE_AI_MODEL = prevModel;
      }
    },
    25 * 60_000,
  );
});
