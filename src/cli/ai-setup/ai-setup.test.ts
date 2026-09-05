/**
 * Unit tests for `oke ai setup` catalog and apply.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyAiSetup, renderAiTs, upsertAiDrivers, upsertEnv } from "./apply.ts";
import {
  aiProviderSelectOptions,
  cloudApplyDefaults,
  cloudChatModels,
  recommendCloudChat,
} from "./catalog.ts";
import { parseAiSetupArgs } from "./index.ts";

describe("catalog", () => {
  test("cloud providers ship short curated chat lists + recommended", () => {
    expect(cloudChatModels("openai").length).toBeGreaterThan(0);
    expect(cloudChatModels("openai").length).toBeLessThanOrEqual(10);
    expect(cloudChatModels("anthropic").some((m) => m.recommended)).toBe(true);
    expect(recommendCloudChat("openai")).toBe("gpt-4o-mini");
    expect(recommendCloudChat("anthropic")).toContain("claude");
  });

  test("aiProviderSelectOptions leads with OpenRouter + cloud / custom / lmstudio", () => {
    const opts = aiProviderSelectOptions();
    expect(opts[0]?.value).toBe("openrouter");
    expect(opts.some((o) => o.value === "groq")).toBe(true);
    expect(opts.some((o) => o.value === "lmstudio")).toBe(true);
    expect(opts.some((o) => o.value === "custom")).toBe(true);
    expect(opts.some((o) => o.value === "mock")).toBe(false);
    expect(aiProviderSelectOptions({ includeMock: true }).some((o) => o.value === "mock")).toBe(
      true,
    );
  });

  test("openrouter curated list includes router aliases", () => {
    const ids = cloudChatModels("openrouter").map((m) => m.id);
    expect(ids).toContain("openrouter/free");
    expect(ids).toContain("openrouter/auto");
    expect(ids).toContain("openrouter/pareto-code");
    expect(ids).toContain("openrouter/fusion");
    expect(ids.length).toBeLessThanOrEqual(10);
    expect(recommendCloudChat("openrouter")).toBe("openrouter/free");
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
    const next = upsertAiDrivers(src, "openai-compatible");
    const body = next
      .replace(/^import\s+[\s\S]*?from\s+["'][^"']+["'];?\s*/m, "")
      .replace(/export\s+default\s+/, "return ");
    const config = new Function("defineConfig", body)(<T>(c: T): T => c) as {
      drivers?: { ai?: unknown; channel?: { ai?: unknown; email?: unknown } };
    };
    expect(config.drivers?.ai).toMatchObject({
      dev: "openai-compatible",
      test: "mock",
      prod: "openai-compatible",
    });
    expect(config.drivers?.channel?.ai).toBeUndefined();
    expect(config.drivers?.channel?.email).toBeDefined();
  });

  test("upsertEnv uncomment / set", () => {
    const env = `# OKE_AI_DRIVER=mock\nOKE_AI_URL=http://x\n`;
    expect(upsertEnv(env, "OKE_AI_DRIVER", "openai-compatible")).toContain("OKE_AI_DRIVER=openai-compatible");
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
      driver: "openai-compatible",
      provider: "openai-compatible",
      chatModel: "gemma4:e4b",
      visionModel: "qwen3-vl:4b",
      embedModel: "nomic-embed-text",
    });
    expect(ts).toContain('ai.model("smart"');
    expect(ts).toContain('provider: "openai-compatible"');
    expect(ts).not.toContain('driverId:');
    expect(ts).toContain('ai.model("local"');
    expect(ts).toContain('ai.model("vision"');
    expect(ts).toContain("docsEmbed");
    expect(ts).toContain('smart.prompt("summarize-note"');
  });

  test("renderAiTs openrouter uses registry provider and OPENROUTER_API_KEY", () => {
    const ts = renderAiTs({
      driver: "openai-compatible",
      provider: "openrouter",
      chatModel: "openrouter/free",
      apiKeyEnv: "OPENROUTER_API_KEY",
    });
    expect(ts).toContain('provider: "openrouter"');
    expect(ts).toContain("openrouter/free");
    expect(ts).toContain("OPENROUTER_API_KEY");
    expect(ts).not.toContain('baseUrl: process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1"');
    expect(ts).toContain("OPENAI_BASE_URL?.trim() ? { baseUrl:");
  });

  test("renderAiTs anthropic uses native driverId", () => {
    const ts = renderAiTs({
      driver: "anthropic",
      provider: "anthropic",
      chatModel: "claude-sonnet-4-20250514",
      apiKeyEnv: "ANTHROPIC_API_KEY",
    });
    expect(ts).toContain('provider: "anthropic"');
    expect(ts).toContain('driverId: "anthropic"');
    expect(ts).toContain("ANTHROPIC_API_KEY");
    expect(ts).not.toContain("api.anthropic.com/v1");
  });

  test("cloudApplyDefaults openrouter omits baseUrl and recommends free alias", () => {
    expect(recommendCloudChat("openrouter")).toBe("openrouter/free");
    const d = cloudApplyDefaults("openrouter");
    expect(d.provider).toBe("openrouter");
    expect(d.baseUrl).toBeUndefined();
    expect(d.apiKeyEnv).toBe("OPENROUTER_API_KEY");
    expect(d.chatModel).toBe("openrouter/free");
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
        driver: "openai-compatible",
        provider: "openai-compatible",
        baseUrl: "http://127.0.0.1:1234/v1",
        chatModel: "local-model",
        visionModel: "vision-model",
        embedModel: "embed-model",
      });

      const config = readFileSync(join(dir, "oke.config.ts"), "utf8");
      expect(config).toContain('dev: "openai-compatible"');
      expect(config).not.toMatch(/\bai:\s*"[^"]+"/);
      const env = readFileSync(join(dir, ".env.local"), "utf8");
      expect(env).toContain("# OKE_AI_DRIVER=openai-compatible");
      expect(env).toMatch(/^#\s*OKE_AI_MODEL=local-model$/m);
      expect(env).not.toMatch(/^OKE_AI_MODEL=/m);
      expect(env).toContain("# OKE_AI_URL=http://127.0.0.1:1234/v1");
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

  test("applyAiSetup ignores template comment examples of ai.model", () => {
    const dir = mkdtempSync(join(tmpdir(), "oke-ai-setup-comment-"));
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
        `import { channel, gate, store, vault } from "okengine";

// --- AI ----------------------------------------------------------------------
// Registry cloud example (no baseUrl — resolved automatically):
//   ai.model("smart", { provider: "openrouter", model: "openrouter/free", apiKey: process.env.OPENROUTER_API_KEY })
`,
        "utf8",
      );
      writeFileSync(join(dir, "src", "app.ts"), `import "@/core";\nexport const app = {};\n`, "utf8");

      applyAiSetup(dir, {
        driver: "openai-compatible",
        provider: "openrouter",
        apiKeyEnv: "OPENROUTER_API_KEY",
        chatModel: "openrouter/free",
      });

      const core = readFileSync(join(dir, "src", "core.ts"), "utf8");
      expect(core).toContain('import { ai, channel, gate, store, vault } from "okengine"');
      expect(core).toContain('export const smart = ai.model("smart"');
      expect(core).toContain('export const local = ai.model("local"');
      expect(core).toContain("export const summarizeNote");
      expect(core).toContain('provider: "openrouter"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("applyAiSetup repairs local+summarizeNote stubs missing smart/ai import", () => {
    const dir = mkdtempSync(join(tmpdir(), "oke-ai-setup-repair-"));
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
        `import { channel, gate, store, vault } from "okengine";

// --- AI ----------------------------------------------------------------------
//   ai.model("smart", { provider: "openrouter", model: "openrouter/free" })

export const local = ai.model("local", {
  provider: "openai-compatible",
  model: process.env.OKE_AI_LOCAL_MODEL ?? "local-model",
  ...(process.env.OKE_AI_URL?.trim() ? { baseUrl: process.env.OKE_AI_URL.trim() } : {}),
});

export const summarizeNote = smart.prompt("summarize-note", {
  via: ["smart", "local"],
  timeout: "30s",
});
`,
        "utf8",
      );
      writeFileSync(join(dir, "src", "app.ts"), `import "@/core";\nexport const app = {};\n`, "utf8");

      applyAiSetup(dir, {
        driver: "openai-compatible",
        provider: "openrouter",
        apiKeyEnv: "OPENROUTER_API_KEY",
        chatModel: "openrouter/free",
      });

      const core = readFileSync(join(dir, "src", "core.ts"), "utf8");
      expect(core).toContain('import { ai, channel, gate, store, vault } from "okengine"');
      expect(core).toContain('export const smart = ai.model("smart"');
      expect(core).toContain('provider: "openrouter"');
      expect(core.match(/export const local = ai\.model/g)?.length).toBe(1);
      expect(core.match(/export const summarizeNote/g)?.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("applyAiSetup cloud OpenRouter clears leftover images.ai", () => {
    const dir = mkdtempSync(join(tmpdir(), "oke-ai-setup-no-docker-"));
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
    ai: "example.invalid/ai-pin:legacy",
  },
});
`,
        "utf8",
      );
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "core.ts"), `import { store } from "okengine";\n`, "utf8");
      writeFileSync(join(dir, "src", "app.ts"), `import "@/core";\nexport const app = {};\n`, "utf8");

      applyAiSetup(dir, {
        driver: "openai-compatible",
        provider: "openrouter",
        apiKeyEnv: "OPENROUTER_API_KEY",
        chatModel: "openrouter/free",
      });

      const config = readFileSync(join(dir, "oke.config.ts"), "utf8");
      expect(config).not.toMatch(/\bai:\s*"[^"]+"/);
      expect(config).toContain("openai-compatible");
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
      writeFileSync(join(dir, "src", "core", "ai.ts"), `import { ai } from "okengine";\n`, "utf8");
      writeFileSync(
        join(dir, "src", "app.ts"),
        `import "@/core";\nexport const app = {};\n`,
        "utf8",
      );

      applyAiSetup(dir, {
        driver: "openai-compatible",
        baseUrl: "http://127.0.0.1:11434/v1",
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
    const a = parseAiSetupArgs([
      "--provider",
      "openrouter",
      "--chat=openrouter/free",
      "--yes",
    ]);
    expect(a.provider).toBe("openrouter");
    expect(a.chat).toBe("openrouter/free");
    expect(a.yes).toBe(true);
  });

  test("rejects unknown --pull flag", () => {
    expect(() => parseAiSetupArgs(["--no-pull"])).toThrow(/unknown option/);
  });
});
