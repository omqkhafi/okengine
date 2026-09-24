/**
 * Tests for interactive Vault gap fill during `oke dev`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resetRequiredEnvNames, resetSecrets } from "../elements/vault/declare.ts";
import { resetBindings } from "../kernel/on.ts";
import { maybeAskVaultGaps, probeVaultGaps, secretPromptWrite } from "./ask-vault-gaps.ts";
import { promptHidden } from "./vault-secure-input.ts";

const OKE = resolve(import.meta.dir, "../index.ts");

afterEach(() => {
  resetBindings();
  resetSecrets();
  resetRequiredEnvNames();
});

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

describe("secretPromptWrite", () => {
  test("keeps the mask on the prompt line", async () => {
    const stdin = new EventEmitter() as EventEmitter & {
      setRawMode?: (mode: boolean) => void;
      off?: (event: string, listener: (...args: unknown[]) => void) => EventEmitter;
    };
    stdin.setRawMode = () => undefined;
    stdin.off = (event: string | symbol, listener: (...args: unknown[]) => void) => {
      stdin.removeListener(event, listener);
      return stdin;
    };
    const shown: string[] = [];
    const echoed: string[] = [];
    const pending = promptHidden("Enter value for OPENROUTER_API_KEY: ", {
      stdin,
      write: secretPromptWrite(
        (text) => shown.push(text),
        (text) => echoed.push(text),
      ),
      exit: () => {
        throw new Error("exit should not run");
      },
    });
    await Promise.resolve();
    stdin.emit("data", "sk");
    stdin.emit("data", "\r");
    expect(await pending).toBe("sk");
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain("Enter value for OPENROUTER_API_KEY: ");
    expect(shown[0]?.endsWith("\n")).toBe(false);
    expect(echoed.join("")).toBe("**\n");
    expect(shown.join("")).not.toContain("*");
  });
});

describe("probeVaultGaps", () => {
  test("sees secrets on oke({ secrets }) after consume drains the registry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "probe-vault-"));
    const name = `PROBE_GAP_${crypto.randomUUID().replaceAll("-", "_")}`;
    try {
      writeFileSync(
        join(dir, "app.ts"),
        `
import { oke, vault } from ${JSON.stringify(OKE)};
export const key = vault.secret(${JSON.stringify(name)}, {
  description: "probe gap",
});
export const app = oke({
  name: "probe-vault",
  autoBoot: false,
  secrets: [key],
});
`,
      );
      const gaps = await probeVaultGaps(dir, "app.ts");
      expect(gaps.map((g) => g.name)).toContain(name);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("sees auto-registered vault.secret after oke() consume", async () => {
    const dir = mkdtempSync(join(tmpdir(), "probe-vault-auto-"));
    const name = `PROBE_AUTO_${crypto.randomUUID().replaceAll("-", "_")}`;
    try {
      writeFileSync(
        join(dir, "app.ts"),
        `
import { oke, vault } from ${JSON.stringify(OKE)};
vault.secret(${JSON.stringify(name)}, { description: "auto registry gap" });
export const app = oke({ name: "probe-vault-auto", autoBoot: false });
`,
      );
      const gaps = await probeVaultGaps(dir, "app.ts");
      expect(gaps.map((g) => g.name)).toContain(name);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
