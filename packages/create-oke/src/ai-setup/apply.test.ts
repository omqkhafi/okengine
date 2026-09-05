/**
 * Unit tests for hybrid-search embed wiring in `oke ai setup` / create-oke.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SEARCH_EMBED_DIMS,
  applyAiSetup,
  ensureAiApiKeyVaultSecret,
  ensureAppStoreSearchEmbed,
  ensureNotesBodyEmbed,
  ensureSummarizeNotePrompt,
  envNameToCamelBinding,
  hasAiApiKeyVaultSecret,
  isIncompleteAiSetup,
  mergeAiApiKeyVaultSecret,
  renderAiTs,
  resolveAiCoreSource,
  upsertEnv,
} from "./apply.ts";

describe("ensureNotesBodyEmbed", () => {
  test("adds bare .embed() after .searchable() on body", () => {
    const src = `
export const notes = store.schema.table("notes", {
  id: field.id().primaryKey(),
  title: field.text().searchable({ weight: 2 }).notNull(),
  body: field.text().searchable().notNull(),
});
`;
    expect(ensureNotesBodyEmbed(src)).toContain(
      "body: field.text().searchable().embed().notNull()",
    );
  });

  test("is idempotent when .embed() already present", () => {
    const src = `body: field.text().searchable().embed().notNull(),`;
    expect(ensureNotesBodyEmbed(src)).toBe(src);
  });

  test("adds .searchable().embed() when body has neither", () => {
    const src = `body: field.text().notNull(),`;
    expect(ensureNotesBodyEmbed(src)).toBe(`body: field.text().searchable().embed().notNull(),`);
  });
});

describe("ensureAppStoreSearchEmbed", () => {
  test("expands oke({ name }) with store.search.embed + embedModel import", () => {
    const src = `import "@/core";
import { oke } from "okengine/http";

export const app = oke({ name: "notes" });
`;
    const next = ensureAppStoreSearchEmbed(src, DEFAULT_SEARCH_EMBED_DIMS);
    expect(next).toContain(`import { embedModel } from "@/core";`);
    expect(next).toContain(`embed: { model: embedModel, dims: ${DEFAULT_SEARCH_EMBED_DIMS} }`);
    expect(next).toContain(`name: "notes"`);
  });

  test("is idempotent when store.search.embed already set", () => {
    const src = `import { embedModel } from "@/core";
export const app = oke({
  name: "notes",
  store: {
    search: {
      embed: { model: embedModel, dims: 768 },
    },
  },
});
`;
    expect(ensureAppStoreSearchEmbed(src, 768)).toBe(src);
  });
});

describe("renderAiTs embed", () => {
  test("documents SQL .embed() vs index ai.embed pipeline", () => {
    const out = renderAiTs({
      driver: "openai-compatible",
      provider: "openai-compatible",
      embedModel: "nomic-embed-text",
    });
    expect(out).toContain("export const embedModel");
    expect(out).toContain("store: { search: { embed } }");
    expect(out).toContain("export const docsEmbed = ai.embed");
    expect(out).toContain("separate from SQL");
  });
});

describe("mergeAiIntoCore vs template comments", () => {
  test("comment-only ai.model examples still get a full smart/local merge", () => {
    const existing = `import { channel, gate, store, vault } from "okengine";

// --- AI ----------------------------------------------------------------------
// Registry cloud example:
//   ai.model("smart", { provider: "openrouter", model: "openrouter/free" })
`;
    const rendered = renderAiTs({
      driver: "openai-compatible",
      provider: "openrouter",
      apiKeyEnv: "OPENROUTER_API_KEY",
      chatModel: "openrouter/free",
    });
    // Template comments must not short-circuit to ensureSummarizeNotePrompt-only.
    expect(ensureSummarizeNotePrompt(existing)).toBe(existing);
    expect(isIncompleteAiSetup(existing)).toBe(false);

    const merged = resolveAiCoreSource(existing, rendered);
    expect(merged).toContain('import { ai, channel, gate, store, vault } from "okengine"');
    expect(merged).toContain('export const smart = ai.model("smart"');
    expect(merged).toContain('export const local = ai.model("local"');
    expect(merged).toContain("export const summarizeNote");
  });

  test("repairs local+summarizeNote stubs missing smart and ai import", () => {
    const broken = `import { channel, gate, store, vault } from "okengine";

// --- AI ----------------------------------------------------------------------
//   ai.model("smart", { provider: "openrouter", model: "openrouter/free" })

/** Local OpenAI-compatible binding (via \`OKE_AI_URL\`). */
export const local = ai.model("local", {
  provider: "openai-compatible",
  model: process.env.OKE_AI_LOCAL_MODEL ?? "local-model",
  ...(process.env.OKE_AI_URL?.trim() ? { baseUrl: process.env.OKE_AI_URL.trim() } : {}),
});

/** Advanced Notes summarize — used by \`notes.summarize\` via \`fx.ask\`. */
export const summarizeNote = smart.prompt("summarize-note", {
  via: ["smart", "local"],
  timeout: "30s",
});
`;
    expect(isIncompleteAiSetup(broken)).toBe(true);
    const rendered = renderAiTs({
      driver: "openai-compatible",
      provider: "openrouter",
      apiKeyEnv: "OPENROUTER_API_KEY",
      chatModel: "openrouter/free",
    });
    const fixed = resolveAiCoreSource(broken, rendered);
    expect(fixed).toContain('import { ai, channel, gate, store, vault } from "okengine"');
    expect(fixed).toContain('export const smart = ai.model("smart"');
    expect(fixed).toContain('provider: "openrouter"');
    expect(fixed.match(/export const local = ai\.model/g)?.length).toBe(1);
    expect(fixed.match(/export const summarizeNote/g)?.length).toBe(1);
  });
});

describe("AI API key vault + env persistence", () => {
  test("envNameToCamelBinding", () => {
    expect(envNameToCamelBinding("OPENROUTER_API_KEY")).toBe("openrouterApiKey");
    expect(envNameToCamelBinding("ANTHROPIC_API_KEY")).toBe("anthropicApiKey");
  });

  test("upsertEnv uncomments an empty # KEY= placeholder", () => {
    const env = `# OPENROUTER_API_KEY=\n# OKE_AI_MODEL=openrouter/free\n`;
    const next = upsertEnv(env, "OPENROUTER_API_KEY", "sk-or-v1-test");
    expect(next).toMatch(/^OPENROUTER_API_KEY=sk-or-v1-test$/m);
    expect(next).not.toMatch(/^#\s*OPENROUTER_API_KEY=/m);
  });

  test("mergeAiApiKeyVaultSecret inserts under Vault heading", () => {
    const existing = `import { channel, gate, store, vault } from "okengine";

// --- Vault -------------------------------------------------------------------

export const webhookSecret = vault.secret("APP_WEBHOOK_SECRET", {
  description: "HMAC",
  dev: "dev-webhook-secret-change-me",
});

// --- AI ----------------------------------------------------------------------
`;
    const next = mergeAiApiKeyVaultSecret(existing, "OPENROUTER_API_KEY");
    expect(hasAiApiKeyVaultSecret(next, "OPENROUTER_API_KEY")).toBe(true);
    expect(next).toContain('export const openrouterApiKey = vault.secret("OPENROUTER_API_KEY"');
    expect(next.indexOf("openrouterApiKey")).toBeLessThan(next.indexOf("webhookSecret"));
    expect(mergeAiApiKeyVaultSecret(next, "OPENROUTER_API_KEY")).toBe(next);
  });

  test("mergeAiApiKeyVaultSecret prepends into NOTES_VAULT list", () => {
    const existing = `import { vault } from "okengine";

export const webhookSecret = vault.secret("APP_WEBHOOK_SECRET", {
  description: "HMAC",
  dev: "x",
});

export const NOTES_VAULT = [
  webhookSecret,
] as const;
`;
    const next = mergeAiApiKeyVaultSecret(existing, "OPENROUTER_API_KEY");
    expect(next).toContain('export const openrouterApiKey = vault.secret("OPENROUTER_API_KEY"');
    expect(next).toMatch(/NOTES_VAULT = \[\s*\n\s*openrouterApiKey,\s*\n\s*webhookSecret,/);
    expect(mergeAiApiKeyVaultSecret(next, "OPENROUTER_API_KEY")).toBe(next);
  });

  test("ensureAiApiKeyVaultSecret prefers src/vault.ts over core.ts", () => {
    const dir = mkdtempSync(join(tmpdir(), "create-oke-vault-ts-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(
        join(dir, "src", "vault.ts"),
        `import { vault } from "okengine";
export const webhookSecret = vault.secret("APP_WEBHOOK_SECRET", { description: "HMAC", dev: "x" });
export const NOTES_VAULT = [
  webhookSecret,
] as const;
`,
        "utf8",
      );
      writeFileSync(join(dir, "src", "core.ts"), `export * from "@/vault";\n`, "utf8");
      ensureAiApiKeyVaultSecret(dir, "OPENROUTER_API_KEY");
      const vault = readFileSync(join(dir, "src", "vault.ts"), "utf8");
      const core = readFileSync(join(dir, "src", "core.ts"), "utf8");
      expect(vault).toContain('vault.secret("OPENROUTER_API_KEY"');
      expect(vault).toMatch(/NOTES_VAULT = \[\s*\n\s*openrouterApiKey,/);
      expect(core).not.toContain("OPENROUTER_API_KEY");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("applyAiSetup writes apiKey into .env.local and vault.secret into core.ts", () => {
    const dir = mkdtempSync(join(tmpdir(), "create-oke-ai-key-"));
    try {
      writeFileSync(
        join(dir, "oke.config.ts"),
        `import { defineConfig } from "okengine/config";
export default defineConfig({
  drivers: {
    channel: { email: { dev: "console", test: "console", prod: "console" } },
  },
});
`,
        "utf8",
      );
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(
        join(dir, "src", "core.ts"),
        `import { store, vault } from "okengine";

// --- Vault -------------------------------------------------------------------

export const webhookSecret = vault.secret("APP_WEBHOOK_SECRET", {
  description: "HMAC",
  dev: "dev-secret",
});

// --- AI ----------------------------------------------------------------------
`,
        "utf8",
      );
      writeFileSync(join(dir, ".env.local"), `# OPENROUTER_API_KEY=\n`, "utf8");

      applyAiSetup(dir, {
        driver: "openai-compatible",
        provider: "openrouter",
        chatModel: "openrouter/free",
        apiKeyEnv: "OPENROUTER_API_KEY",
        apiKey: "sk-or-v1-from-wizard",
      });

      const env = readFileSync(join(dir, ".env.local"), "utf8");
      expect(env).toMatch(/^OPENROUTER_API_KEY=sk-or-v1-from-wizard$/m);
      const core = readFileSync(join(dir, "src", "core.ts"), "utf8");
      expect(core).toContain('vault.secret("OPENROUTER_API_KEY"');
      expect(core).toContain('export const smart = ai.model("smart"');
      expect(existsSync(join(dir, "src", "core", "ai.ts"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
