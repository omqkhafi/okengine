/**
 * G4 — auth / vault hot path (pure CPU, no infra).
 *
 *   • `authenticateApiKey` at 1k → 10k → 50k iterations (in-memory store)
 *   • raw HMAC-SHA-256 verify (`hashApiKeySecret`) isolated
 *   • A/B: boot-bag `vaultRuntime.read` vs request-time `fx.vault.get`
 *     over ≥10k reads each → added p99 of the fx wrapper
 *
 * Run: bun test ./src/bench/g04-auth-vault-hotpath.bench.ts
 */

import { describe, expect, test } from "bun:test";
import {
  authenticateApiKey,
  createApiKey,
  createApiKeyStore,
  hashApiKeySecret,
} from "../auth/api-keys.ts";
import { createVaultRuntime } from "../elements/vault/runtime.ts";
import { vault } from "../elements/vault/declare.ts";
import { createFx } from "../kernel/fx.ts";
import { DISCLAIMER, HARDWARE, summarize, writeArtifact } from "./lib/report.ts";

const CAL = process.env.OKE_BENCH_CAL === "1";
const AUTH_ITERS: readonly number[] = CAL ? [1_000] : [1_000, 10_000, 50_000];
const VAULT_READS = CAL ? 2_000 : 20_000;
const SECRET_NAME = "OKE_BENCH_G4_SECRET";

/** Time an async op `iters` times; returns per-op latency samples in ms. */
async function timeLoop(iters: number, op: () => Promise<unknown>): Promise<number[]> {
  const samples: number[] = new Array(iters);
  for (let i = 0; i < iters; i += 1) {
    const s = performance.now();
    await op();
    samples[i] = performance.now() - s;
  }
  return samples;
}

describe.skipIf(!process.env.OKE_BENCH)("G4 — auth/vault hot path", () => {
  test(
    "authenticateApiKey + HMAC sweep",
    async () => {
      const store = createApiKeyStore();
      const creatorScopes = new Set(["read", "write"]);
      const created = await createApiKey(store, {
        plane: "user" as never,
        name: "bench-key",
        scopes: ["read"],
        creatorId: "bench",
        creatorScopes,
      });

      const metrics: Record<string, number> = {};
      const issues: string[] = [];

      // Raw HMAC verify (the inner hash of every auth attempt).
      const hmac = await timeLoop(AUTH_ITERS[0]!, () => hashApiKeySecret(created.secret));
      const hmacS = summarize(hmac);
      metrics["hmac.p50Ms"] = hmacS.p50Ms;
      metrics["hmac.p99Ms"] = hmacS.p99Ms;
      metrics["hmac.opsPerSec"] = hmacS.opsPerSec;

      // Full authenticateApiKey (hash + scan + persist no-op).
      for (const iters of AUTH_ITERS) {
        const samples = await timeLoop(iters, async () => {
          const row = await authenticateApiKey(store, created.secret);
          if (!row) throw new Error("authenticateApiKey returned null");
        });
        const s = summarize(samples);
        metrics[`auth.n${iters}.p50Ms`] = s.p50Ms;
        metrics[`auth.n${iters}.p99Ms`] = s.p99Ms;
        metrics[`auth.n${iters}.opsPerSec`] = s.opsPerSec;
      }

      console.log("[G4] auth metrics:", JSON.stringify(metrics));

      // Sanity: wrong secret must not match.
      expect(await authenticateApiKey(store, "oke_bogus")).toBeNull();

      const path = await writeArtifact({
        group: "G4-auth",
        hardware: HARDWARE,
        disclaimer: DISCLAIMER,
        command: "OKE_BENCH=1 bun test ./src/bench/g04-auth-vault-hotpath.bench.ts",
        metrics,
        issues,
        fixes: [],
        remeasured: null,
      });
      console.log(`[G4] auth artifact: ${path}`);
    },
    CAL ? 60_000 : 180_000,
  );

  test(
    "vault boot-bag read vs request-time fx.vault.get",
    async () => {
      const vaultRt = createVaultRuntime({
        secrets: [vault.config(SECRET_NAME, { dev: "bench-value-0123456789" })],
        allowDevFallbacks: true,
      });
      await vaultRt.boot();

      // A: direct boot-bag read (sync).
      const bootSamples: number[] = [];
      for (let i = 0; i < VAULT_READS; i += 1) {
        const s = performance.now();
        const v = vaultRt.read(SECRET_NAME);
        if (v !== "bench-value-0123456789") throw new Error("boot-bag read mismatch");
        bootSamples.push(performance.now() - s);
      }

      // B: per-request fx.vault.get (capability + effect ledger + redaction hook).
      const fx = createFx({ flow: "bench.g4", vaultRuntime: vaultRt });
      const fxBaseline: number[] = [];
      for (let i = 0; i < VAULT_READS; i += 1) {
        const s = performance.now();
        const v = await fx.vault.get(SECRET_NAME);
        if (v.reveal() !== "bench-value-0123456789") throw new Error("fx read mismatch");
        fxBaseline.push(performance.now() - s);
      }
      // Second fx pass to warm JSC before trusting percentiles.
      const fxSamples: number[] = [];
      for (let i = 0; i < VAULT_READS; i += 1) {
        const s = performance.now();
        await fx.vault.get(SECRET_NAME);
        fxSamples.push(performance.now() - s);
      }

      const a = summarize(bootSamples);
      const b = summarize(fxSamples);
      const addedP99Ms = Number((b.p99Ms - a.p99Ms).toFixed(3));
      const metrics: Record<string, number> = {
        "bootBag.reads": VAULT_READS,
        "bootBag.p50Ms": a.p50Ms,
        "bootBag.p99Ms": a.p99Ms,
        "bootBag.opsPerSec": a.opsPerSec,
        "fx.get.reads": VAULT_READS,
        "fx.get.p50Ms": b.p50Ms,
        "fx.get.p99Ms": b.p99Ms,
        "fx.get.opsPerSec": b.opsPerSec,
        addedP99Ms: addedP99Ms,
        addedP50Ms: Number((b.p50Ms - a.p50Ms).toFixed(3)),
      };

      console.log("[G4] vault metrics:", JSON.stringify(metrics));
      void fxBaseline;

      const issues: string[] = [];
      if (addedP99Ms > 1) {
        issues.push(`fx.vault.get adds ${addedP99Ms}ms p99 over boot-bag read (>1ms budget watch)`);
      }

      const path = await writeArtifact({
        group: "G4-vault",
        hardware: HARDWARE,
        disclaimer: DISCLAIMER,
        command: "OKE_BENCH=1 bun test ./src/bench/g04-auth-vault-hotpath.bench.ts",
        metrics,
        issues,
        fixes: [],
        remeasured: null,
      });
      console.log(`[G4] vault artifact: ${path}`);
      expect(b.opsPerSec).toBeGreaterThan(0);
    },
    CAL ? 30_000 : 120_000,
  );
});
