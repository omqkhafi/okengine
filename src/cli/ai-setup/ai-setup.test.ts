/**
 * Unit tests for `oke ai setup` catalog, detect, and apply.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyAiSetup, renderAiTs, upsertAiDrivers, upsertEnv } from "./apply.ts";
import { cloudChatModels, recommendChatModel, recommendCloudChat } from "./catalog.ts";
import { isInstalled, parseOllamaList } from "./detect-ollama.ts";
import { parseAiSetupArgs } from "./index.ts";

describe("catalog", () => {
  test("recommendChatModel respects RAM tiers", () => {
    expect(recommendChatModel(8).ramGb).toBeLessThanOrEqual(8);
    expect(recommendChatModel(16).ramGb).toBeLessThanOrEqual(16);
    expect(recommendChatModel(null).recommended).toBe(true);
  });

  test("cloud providers ship short curated chat lists + recommended", () => {
    expect(cloudChatModels("openai").length).toBeGreaterThan(0);
    expect(cloudChatModels("openai").length).toBeLessThanOrEqual(10);
    expect(cloudChatModels("anthropic").some((m) => m.recommended)).toBe(true);
    expect(recommendCloudChat("openai")).toBe("gpt-4o-mini");
    expect(recommendCloudChat("anthropic")).toContain("claude");
  });
});

describe("detect-ollama", () => {
  test("parseOllamaList skips header", () => {
    const out = parseOllamaList(`NAME           ID      SIZE
qwen3.5:9b     abc     5.0 GB
nomic-embed-text  def  274 MB
`);
    expect(out).toEqual(["qwen3.5:9b", "nomic-embed-text"]);
  });

  test("isInstalled matches mlx suffixes", () => {
    expect(isInstalled("qwen3.5:9b", ["qwen3.5:9b-mlx"])).toBe(true);
    expect(isInstalled("gemma4:e4b", ["qwen3.5:9b"])).toBe(false);
  });
});

describe("apply", () => {
  test("upsertAiDrivers inserts after channel (sibling, not nested)", () => {
    const src = `export default defineConfig({
  drivers: {
    channel: {
      email: {
        local: "console",
        docker: "smtp",
        test: "console",
        prod: "smtp",
      },
    },
  },
  images: {},
});
`;
    const next = upsertAiDrivers(src, "ollama");
    expect(next).toMatch(/^ {4}ai:\s*\{/m);
    expect(next).toContain('local: "ollama"');
    const channel = next.match(/^ {4}channel:\s*\{[\s\S]*?\n {4}\},?\n/m)?.[0] ?? "";
    expect(channel).toContain("email:");
    expect(channel).not.toContain("ai:");
  });

  test("upsertEnv uncomment / set", () => {
    const env = `# OKE_AI_DRIVER=mock\nOKE_AI_URL=http://x\n`;
    expect(upsertEnv(env, "OKE_AI_DRIVER", "ollama")).toContain("OKE_AI_DRIVER=ollama");
  });

  test("upsertEnv writes API token when provided", () => {
    const env = `# OKE_AI_DRIVER=mock\n`;
    expect(upsertEnv(env, "OPENAI_API_KEY", "sk-test")).toContain("OPENAI_API_KEY=sk-test");
  });

  test("renderAiTs includes vision + embed", () => {
    const ts = renderAiTs({
      driver: "ollama",
      chatModel: "gemma4:e4b",
      visionModel: "qwen3-vl:4b",
      embedModel: "nomic-embed-text",
    });
    expect(ts).toContain('ai.model("smart"');
    expect(ts).toContain('ai.model("vision"');
    expect(ts).toContain("docsEmbed");
  });

  test("applyAiSetup writes config, env, ai.ts", () => {
    const dir = mkdtempSync(join(tmpdir(), "oke-ai-setup-"));
    try {
      writeFileSync(
        join(dir, "oke.config.ts"),
        `import { defineConfig } from "okengine/config";
export default defineConfig({
  drivers: {
    channel: {
      email: {
        local: "console",
        docker: "smtp",
        test: "console",
        prod: "smtp",
      },
    },
  },
  images: {
    "store.sql": "postgres:18-alpine",
  },
});
`,
        "utf8",
      );
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "app.ts"), `export const app = {};\n`, "utf8");

      applyAiSetup(dir, {
        driver: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        chatModel: "gemma4:e4b",
        visionModel: "qwen3-vl:4b",
        embedModel: "nomic-embed-text",
      });

      const config = readFileSync(join(dir, "oke.config.ts"), "utf8");
      expect(config).toContain('local: "ollama"');
      expect(config).toContain('ai: "ollama/ollama:latest"');
      const env = readFileSync(join(dir, ".env.local"), "utf8");
      expect(env).toContain("OKE_AI_DRIVER=ollama");
      expect(env).toContain("OKE_AI_MODEL=gemma4:e4b");
      const aiTs = readFileSync(join(dir, "src", "ai.ts"), "utf8");
      expect(aiTs).toContain("smart");
      const app = readFileSync(join(dir, "src", "app.ts"), "utf8");
      expect(app).toContain('import "./ai"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseAiSetupArgs", () => {
  test("parses provider and models", () => {
    const a = parseAiSetupArgs(["--provider", "ollama", "--chat=qwen3.5:9b", "--no-pull", "--yes"]);
    expect(a.provider).toBe("ollama");
    expect(a.chat).toBe("qwen3.5:9b");
    expect(a.pull).toBe(false);
    expect(a.yes).toBe(true);
  });
});
