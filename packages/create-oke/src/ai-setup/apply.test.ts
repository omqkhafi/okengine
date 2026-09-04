/**
 * Unit tests for hybrid-search embed wiring in `oke ai setup` / create-oke.
 */

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SEARCH_EMBED_DIMS,
  ensureAppStoreSearchEmbed,
  ensureNotesBodyEmbed,
  ensureSummarizeNotePrompt,
  isIncompleteAiSetup,
  renderAiTs,
  resolveAiCoreSource,
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
      provider: "ollama",
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

/** Local inference binding (docker llama.cpp / Ollama via \`OKE_AI_URL\`). */
export const local = ai.model("local", {
  provider: "openai-compatible",
  model: process.env.OKE_AI_LOCAL_MODEL ?? "granite3.3:2b",
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
