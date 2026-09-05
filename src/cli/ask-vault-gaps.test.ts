/**
 * Tests for interactive Vault gap fill during `oke dev`.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maybeAskVaultGaps } from "./ask-vault-gaps.ts";

describe("maybeAskVaultGaps", () => {
  test("skips when non-TTY", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ask-vault-"));
    try {
      let reads = 0;
      const code = await maybeAskVaultGaps({
        cwd: dir,
        stdinIsTTY: false,
        gapsFn: async () => [{ name: "OPENROUTER_API_KEY", description: "OpenRouter API key" }],
        readSecret: async () => {
          reads += 1;
          return "sk-test";
        },
      });
      expect(code).toBe(0);
      expect(reads).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("writes each gap into .env.local and hydrates process.env", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ask-vault-"));
    const prev = process.env.OPENROUTER_API_KEY;
    try {
      delete process.env.OPENROUTER_API_KEY;
      const prompts: string[] = [];
      const code = await maybeAskVaultGaps({
        cwd: dir,
        stdinIsTTY: true,
        gapsFn: async () => [
          { name: "OPENROUTER_API_KEY", description: "OpenRouter API key" },
          { name: "OTHER_SECRET" },
        ],
        readSecret: async (prompt) => {
          prompts.push(prompt);
          return prompt.includes("OPENROUTER") ? "sk-or-v1-test" : "other-value";
        },
      });
      expect(code).toBe(0);
      expect(prompts).toHaveLength(2);
      // `delete process.env.OPENROUTER_API_KEY` narrows that property to
      // `undefined` for the rest of the block — widen before asserting.
      expect(process.env.OPENROUTER_API_KEY as string | undefined).toBe("sk-or-v1-test");
      expect(process.env.OTHER_SECRET as string | undefined).toBe("other-value");
      const env = readFileSync(join(dir, ".env.local"), "utf8");
      expect(env).toContain("OPENROUTER_API_KEY=sk-or-v1-test");
      expect(env).toContain("OTHER_SECRET=other-value");
    } finally {
      if (prev === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = prev;
      delete process.env.OTHER_SECRET;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("empty value leaves a gap and returns 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ask-vault-"));
    try {
      const logs: string[] = [];
      const code = await maybeAskVaultGaps({
        cwd: dir,
        stdinIsTTY: true,
        write: (t) => logs.push(t),
        gapsFn: async () => [{ name: "OPENROUTER_API_KEY" }],
        readSecret: async () => "",
      });
      expect(code).toBe(1);
      expect(logs.some((l) => l.includes("missing secret"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
