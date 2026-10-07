/**
 * `oke decide certify` writes one certificate per decider.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ai, resetAiDecls } from "../elements/ai.ts";
import { resetDecisionCertificates } from "../elements/ai/decisions/certificate.ts";
import { ALIAS_CERTIFICATE_MS } from "../elements/ai/deciders/presets.ts";
import { certifyDecisionDeciders } from "./decide.ts";

afterEach(() => {
  resetAiDecls();
  resetDecisionCertificates();
});

function seed(): string {
  return Array.from({ length: 160 }, () =>
    JSON.stringify({ input: { ticket: "1" }, expect: { team: "technical" } }),
  ).join("\n");
}

function body(model: string) {
  return {
    model,
    answers: {
      team: {
        type: "choice" as const,
        choice: "technical",
        probabilities: { billing: 0.05, technical: 0.93, none_of_these: 0.02 },
      },
    },
    usage: { cost: 0.01 },
  };
}

describe("oke decide certify", () => {
  test("two mock deciders each get a certificate and an alias is unpinned", async () => {
    const question = ai.choice("which team", { billing: "Billing", technical: "Technical" });
    ai.decider("jev", { provider: "openrouter", model: "typesafe/jev-1.13.0" });
    ai.decider("luna", { provider: "openai", model: "gpt-6-luna" });
    ai.decision("triage", {
      decider: ai.decider("jev", { provider: "openrouter", model: "typesafe/jev-1.13.0" }),
      backup: [ai.decider("luna", { provider: "openai", model: "gpt-6-luna" })],
      otherwise: "abstain",
      autonomy: { maxError: 0.05, audit: 0 },
      ask: { team: question },
    });
    const root = await mkdtemp(join(tmpdir(), "oke-certify-"));
    const evals = join(root, "seed.jsonl");
    await Bun.write(evals, seed());
    const lines: string[] = [];
    const now = 1_700_000_000_000;
    const lock = await certifyDecisionDeciders({
      root,
      decision: "triage",
      deciders: ["jev", "luna"],
      now: () => now,
      fetcher: async () => new Response("offline", { status: 404 }),
      write: (line) => {
        lines.push(line);
      },
      evaluate: {
        jev: async () => body("typesafe/jev-1.13.0"),
        luna: async () => body("gpt-6-luna"),
      },
      manifest: {
        oke: "1.0",
        app: "cert",
        ai: {
          deciders: {
            jev: {
              driverId: "systemone",
              baseUrl: "https://openrouter.ai/api/alpha/decisions",
              model: "typesafe/jev-1.13.0",
              secret: "OPENROUTER_API_KEY",
              pinning: "dated",
              capabilities: { boolean: true, choice: true, score: true, refusal: false },
            },
            luna: {
              driverId: "openai-decisions",
              baseUrl: "https://api.openai.com/v1/decisions",
              model: "gpt-6-luna",
              secret: "OPENAI_API_KEY",
              pinning: "alias",
              capabilities: { boolean: true, choice: true, score: true, refusal: true },
            },
          },
          decisions: {
            triage: {
              mode: "abstain",
              decider: "jev",
              backup: ["luna"],
              otherwise: "abstain",
              questions: ["team"],
              evals,
              autonomy: { maxError: 0.05, audit: 0 },
            },
          },
        },
      },
    });
    expect(lock.version).toBe(2);
    expect(lock.decisions.triage?.deciders.jev?.pinned).toBe(true);
    expect(lock.decisions.triage?.deciders.jev?.model).toBe("typesafe/jev-1.13.0");
    expect(lock.decisions.triage?.deciders.luna).toMatchObject({
      model: "gpt-6-luna",
      pinned: false,
      expiresAt: now + ALIAS_CERTIFICATE_MS,
    });
    expect(lines.some((line) => line.includes('decider "luna"') && line.includes("unpinned"))).toBe(
      true,
    );
    expect(lines.some((line) => line.startsWith("jev\tteam\taccuracy"))).toBe(true);
    expect(lines.some((line) => line.startsWith("luna\tteam\taccuracy"))).toBe(true);
  });

  test("a dated catalog slug is required when it differs from the configured model", async () => {
    ai.decider("jev", { provider: "openrouter", model: "typesafe/jev-1.13" });
    ai.decision("triage", {
      decider: ai.decider("jev", { provider: "openrouter", model: "typesafe/jev-1.13" }),
      otherwise: "abstain",
      ask: { team: ai.choice("which", { a: "A" }) },
    });
    const root = await mkdtemp(join(tmpdir(), "oke-dated-"));
    const evals = join(root, "seed.jsonl");
    await Bun.write(evals, seed());
    await expect(
      certifyDecisionDeciders({
        root,
        decision: "triage",
        deciders: ["jev"],
        evaluate: { jev: async () => body("typesafe/jev-1.13") },
        fetcher: async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  id: "typesafe/jev-1.13",
                  canonical_slug: "typesafe/jev-1.13-20260917",
                },
              ],
            }),
            { status: 200 },
          ),
        manifest: {
          oke: "1.0",
          app: "cert",
          ai: {
            decisions: {
              triage: {
                mode: "abstain",
                decider: "jev",
                otherwise: "abstain",
                questions: ["team"],
                evals,
              },
            },
          },
        },
      }),
    ).rejects.toThrow(/autonomy requires model "typesafe\/jev-1.13-20260917"/);
  });
});
