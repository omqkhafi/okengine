/**
 * G7a — Vault raw crypto throughput (pure CPU).
 *
 * AES-256-GCM round-trips via `src/elements/vault/crypto.ts` — encrypt /
 * decrypt / full round-trip ops-per-second at 1 KiB and 64 KiB payloads,
 * with AAD bound exactly as production secrets are.
 *
 * Run: bun test ./src/bench/g07-vault-crypto.bench.ts
 */

import { describe, expect, test } from "bun:test";
import {
  buildAad,
  decryptSecret,
  encryptSecret,
  generateDek,
  importAesKey,
} from "../elements/vault/crypto.ts";
import { DISCLAIMER, HARDWARE, summarize, writeArtifact } from "./lib/report.ts";

const CAL = process.env.OKE_BENCH_CAL === "1";
const ITERS = CAL ? 1_000 : 10_000;
const SIZES = [
  { label: "1KiB", bytes: 1024 },
  { label: "64KiB", bytes: 64 * 1024 },
] as const;

describe.skipIf(!process.env.OKE_BENCH)("G7a — vault crypto", () => {
  test(
    "AES-GCM encrypt/decrypt/round-trip at 1 KiB and 64 KiB",
    async () => {
      const dek = await importAesKey(generateDek());
      const metrics: Record<string, number> = {};

      for (const size of SIZES) {
        const plaintext = "x".repeat(size.bytes);
        const aad = buildAad("bench/crypto", 1, "aes-256-gcm", 1);

        // Encrypt.
        const encSamples: number[] = [];
        let sealed;
        for (let i = 0; i < ITERS; i += 1) {
          const s = performance.now();
          sealed = await encryptSecret(dek, plaintext, aad);
          encSamples.push(performance.now() - s);
        }

        // Decrypt (of the last sealed blob — same shape every time).
        const decSamples: number[] = [];
        for (let i = 0; i < ITERS; i += 1) {
          const s = performance.now();
          const out = await decryptSecret(dek, sealed!, aad);
          if (out !== plaintext) throw new Error("decrypt mismatch");
          decSamples.push(performance.now() - s);
        }

        // Full round-trip.
        const rtSamples: number[] = [];
        for (let i = 0; i < ITERS; i += 1) {
          const s = performance.now();
          const blob = await encryptSecret(dek, plaintext, aad);
          const out = await decryptSecret(dek, blob, aad);
          if (out !== plaintext) throw new Error("round-trip mismatch");
          rtSamples.push(performance.now() - s);
        }

        const e = summarize(encSamples);
        const d = summarize(decSamples);
        const r = summarize(rtSamples);
        metrics[`${size.label}.encrypt.p50Ms`] = e.p50Ms;
        metrics[`${size.label}.encrypt.p99Ms`] = e.p99Ms;
        metrics[`${size.label}.encrypt.opsPerSec`] = e.opsPerSec;
        metrics[`${size.label}.decrypt.p50Ms`] = d.p50Ms;
        metrics[`${size.label}.decrypt.p99Ms`] = d.p99Ms;
        metrics[`${size.label}.decrypt.opsPerSec`] = d.opsPerSec;
        metrics[`${size.label}.roundTrip.p50Ms`] = r.p50Ms;
        metrics[`${size.label}.roundTrip.p99Ms`] = r.p99Ms;
        metrics[`${size.label}.roundTrip.opsPerSec`] = r.opsPerSec;

        console.log(
          `[G7a] ${size.label}: enc=${e.opsPerSec}/s dec=${d.opsPerSec}/s rt=${r.opsPerSec}/s`,
        );
      }

      const path = await writeArtifact({
        group: "G7a-crypto",
        hardware: HARDWARE,
        disclaimer: DISCLAIMER,
        command: "OKE_BENCH=1 bun test ./src/bench/g07-vault-crypto.bench.ts",
        metrics,
        issues: [],
        fixes: [],
        remeasured: null,
      });
      console.log(`[G7a] artifact: ${path}`);
      expect(metrics["1KiB.roundTrip.opsPerSec"]).toBeGreaterThan(0);
    },
    CAL ? 60_000 : 300_000,
  );
});
