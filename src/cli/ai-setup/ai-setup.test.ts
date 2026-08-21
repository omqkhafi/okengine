/**
 * Unit tests for `oke ai setup` catalog, detect, and apply.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
        dev: "smtp",
        test: "console",
        prod: "smtp",
      },
    },
  },
  images: {},
});
`;
    const next = upsertAiDrivers(src, "ollama");
    const body = next
      .replace(/^import\s+[\s\S]*?from\s+["'][^"']+["'];?\s*/m, "")
      .replace(/export\s+default\s+/, "return ");
    const config = new Function("defineConfig", body)(<T>(c: T): T => c) as {
      drivers?: { ai?: unknown; channel?: { ai?: unknown; email?: unknown } };
    };
    expect(config.drivers?.ai).toMatchObject({
      dev: "ollama",
      test: "mock",
      prod: "ollama",
    });
    expect(config.drivers?.channel?.ai).toBeUndefined();
    expect(config.drivers?.channel?.email).toBeDefined();
  });

  test("upsertEnv uncomment / set", () => {
    const env = `# OKE_AI_DRIVER=mock\nOKE_AI_URL=http://x\n`;
    expect(upsertEnv(env, "OKE_AI_DRIVER", "ollama")).toContain("OKE_AI_DRIVER=ollama");
  });

  test("upsertEnv comment keeps stack keys as overrides", () => {
    const env = `# OKE_AI_DRIVER=mock\nOKE_AI_URL=http://x\n`;
    const next = upsertEnv(env, "OKE_AI_URL", "http://127.0.0.1:8080/v1", { comment: true });
    expect(next).toContain("# OKE_AI_URL=http://127.0.0.1:8080/v1");
    expect(next).not.toMatch(/^OKE_AI_URL=/m);
  });

  test("upsertEnv writes API token when provided", () => {
    const env = `# OKE_AI_DRIVER=mock\n`;
    expect(upsertEnv(env, "OPENAI_API_KEY", "sk-test")).toContain("OPENAI_API_KEY=sk-test");
  });

  test("renderAiTs includes vision + embed + summarize-note + local", () => {
    const ts = renderAiTs({
      driver: "ollama",
      chatModel: "gemma4:e4b",
      visionModel: "qwen3-vl:4b",
      embedModel: "nomic-embed-text",
    });
    expect(ts).toContain('ai.model("smart"');
    expect(ts).toContain('ai.model("local"');
    expect(ts).toContain('ai.model("vision"');
    expect(ts).toContain("docsEmbed");
    expect(ts).toContain('smart.prompt("summarize-note"');
  });

  test("applyAiSetup writes config, env, AI models in core.ts", () => {
    const dir = mkdtempSync(join(tmpdir(), "oke-ai-setup-"));
    try {
      writeFileSync(
        join(dir, "oke.config.ts"),
        `import { defineConfig } from "okengine/config";
export default defineConfig({
  drivers: {
    channel: {
      email: {
        dev: "smtp",
        test: "console",
        prod: "smtp",
      },
    },
  },
  images: {
    store: {
      sql: "postgres:18-alpine",
    },
  },
});
`,
        "utf8",
      );
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(
        join(dir, "src", "core.ts"),
        `import { store } from "okengine";\n\nexport const db = store.sql("app");\n`,
        "utf8",
      );
      writeFileSync(
        join(dir, "src", "app.ts"),
        `import "@/core";\nexport const app = {};\n`,
        "utf8",
      );

      applyAiSetup(dir, {
        driver: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        chatModel: "gemma4:e4b",
        visionModel: "qwen3-vl:4b",
        embedModel: "nomic-embed-text",
      });

      const config = readFileSync(join(dir, "oke.config.ts"), "utf8");
      expect(config).toContain('dev: "ollama"');
      expect(config).toContain('ai: "ollama/ollama:0.32.13"');
      const env = readFileSync(join(dir, ".env.local"), "utf8");
      expect(env).toContain("# OKE_AI_DRIVER=ollama");
      expect(env).toMatch(/^#\s*OKE_AI_MODEL=gemma4:e4b$/m);
      expect(env).not.toMatch(/^OKE_AI_MODEL=/m);
      expect(env).toContain("# OKE_AI_URL=http://127.0.0.1:11434");
      expect(env).not.toMatch(/^OKE_AI_URL=/m);
      const core = readFileSync(join(dir, "src", "core.ts"), "utf8");
      expect(core).toContain('import { ai, store } from "okengine"');
      expect(core).toContain("smart");
      expect(core).toContain('ai.model("vision"');
      expect(existsSync(join(dir, "src", "core", "ai.ts"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("applyAiSetup prefers an existing src/core/ai.ts over a thin core.ts barrel", () => {
    const dir = mkdtempSync(join(tmpdir(), "oke-ai-setup-split-"));
    try {
      writeFileSync(
        join(dir, "oke.config.ts"),
        `import { defineConfig } from "okengine/config";
export default defineConfig({
  drivers: {
    channel: {
      email: {
        dev: "smtp",
        test: "console",
        prod: "smtp",
      },
    },
  },
  images: {
    store: {
      sql: "postgres:18-alpine",
    },
  },
});
`,
        "utf8",
      );
      mkdirSync(join(dir, "src", "core"), { recursive: true });
      writeFileSync(
        join(dir, "src", "core.ts"),
        `export * from "./core/store.ts";\nexport * from "./core/ai.ts";\n`,
        "utf8",
      );
      writeFileSync(
        join(dir, "src", "core", "store.ts"),
        `import { store } from "okengine";\n\nexport const db = store.sql("app");\n`,
        "utf8",
      );
      writeFileSync(
        join(dir, "src", "core", "ai.ts"),
        `import { ai } from "okengine";\n`,
        "utf8",
      );
      writeFileSync(
        join(dir, "src", "app.ts"),
        `import "@/core";\nexport const app = {};\n`,
        "utf8",
      );

      applyAiSetup(dir, {
        driver: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        chatModel: "gemma4:e4b",
        visionModel: "qwen3-vl:4b",
        embedModel: "nomic-embed-text",
      });

      const barrel = readFileSync(join(dir, "src", "core.ts"), "utf8");
      expect(barrel).not.toContain("ai.model");
      expect(barrel).toContain('export * from "./core/ai.ts"');
      const aiTs = readFileSync(join(dir, "src", "core", "ai.ts"), "utf8");
      expect(aiTs).toContain("smart");
      expect(aiTs).toContain('ai.model("vision"');
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
