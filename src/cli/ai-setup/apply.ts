/**
 * Write AI driver config, env, and AI models into `src/core.ts` for `oke ai setup`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { OLLAMA_IMAGE } from "../../docker/recipes/index.ts";
import { DEFAULT_DOCKER_DIR } from "../../docker/types.ts";

/** Choices applied to the project. */
export type AiSetupApplyInput = {
  readonly driver: "ollama" | "anthropic" | "openai-compatible" | "mock";
  readonly baseUrl?: string;
  readonly chatModel?: string;
  readonly visionModel?: string | null;
  readonly embedModel?: string | null;
  readonly apiKeyEnv?: string;
  /** When set with {@link apiKeyEnv}, writes the token into `.env.local`. */
  readonly apiKey?: string;
  /** Optional `images.ai` pin (llama.cpp / Ollama / vLLM / SGLang). */
  readonly image?: string;
};

/** Options for {@link applyAiSetup}. */
export type AiSetupApplyOptions = {
  /**
   * When false, leave `drivers.ai` / `images.ai` alone (create-oke already
   * wrote per-env pins). Default true for standalone `oke ai setup`.
   */
  readonly updateDrivers?: boolean;
};

/**
 * Apply AI setup to a project root.
 *
 * @param cwd - Project root
 * @param input - Selected provider / models
 * @param options - Pin-preserving knobs for create-oke
 */
export function applyAiSetup(
  cwd: string,
  input: AiSetupApplyInput,
  options: AiSetupApplyOptions = {},
): {
  readonly configPath: string;
  readonly envPath: string;
  readonly aiTsPath: string;
} {
  const updateDrivers = options.updateDrivers !== false;
  const configPath = join(cwd, "oke.config.ts");
  if (!existsSync(configPath)) {
    throw new Error("oke ai setup: no oke.config.ts in the current directory");
  }

  if (updateDrivers) {
    let config = readFileSync(configPath, "utf8");
    config = upsertAiDrivers(config, input.driver);
    if (input.image) {
      config = upsertImage(config, "ai", input.image);
    } else if (input.driver === "ollama") {
      config = upsertImage(config, "ai", OLLAMA_IMAGE);
    }
    writeFileSync(configPath, config, "utf8");
  }

  const envPath = join(cwd, ".env.local");
  const envExample = join(cwd, ".env.example");
  let env = existsSync(envPath)
    ? readFileSync(envPath, "utf8")
    : existsSync(envExample)
      ? readFileSync(envExample, "utf8")
      : "";
  // Driver / URL / model stay commented so docker mode can hydrate from
  // `docker/.env.docker` without being shadowed. The chosen model is still
  // written into `.env.local` as a hint (and into `.env.docker` when present);
  // `loadExistingStackControls` seeds commented `OKE_AI_MODEL` on first boot.
  env = upsertEnv(env, "OKE_AI_DRIVER", input.driver, { comment: true });
  if (input.baseUrl) env = upsertEnv(env, "OKE_AI_URL", input.baseUrl, { comment: true });
  if (input.chatModel) {
    env = upsertEnv(env, "OKE_AI_MODEL", input.chatModel, { comment: true });
  }
  if (input.visionModel) {
    env = upsertEnv(env, "OKE_AI_VISION_MODEL", input.visionModel, { comment: true });
  }
  if (input.embedModel) {
    env = upsertEnv(env, "OKE_AI_EMBED_MODEL", input.embedModel, { comment: true });
  }
  if (input.apiKeyEnv) {
    if (input.apiKey !== undefined && input.apiKey.length > 0) {
      env = upsertEnv(env, input.apiKeyEnv, input.apiKey);
    } else if (!new RegExp(`^#?\\s*${input.apiKeyEnv}=`, "m").test(env)) {
      env = `${env.trimEnd()}\n# ${input.apiKeyEnv}=\n`;
    }
  }
  writeFileSync(envPath, env.endsWith("\n") ? env : `${env}\n`, "utf8");

  // `docker/.env.docker` is regenerated from `.env.local` only on its first
  // boot (existing values there are treated as durable, possibly hand-edited
  // pins — see stack-id.ts). Once it exists, a later `oke ai setup` run must
  // update it directly, or the docker profile keeps the old model forever.
  if (input.chatModel) {
    const dockerEnvPath = join(cwd, DEFAULT_DOCKER_DIR, ".env.docker");
    if (existsSync(dockerEnvPath)) {
      const dockerEnv = readFileSync(dockerEnvPath, "utf8");
      writeFileSync(dockerEnvPath, upsertEnv(dockerEnv, "OKE_AI_MODEL", input.chatModel), "utf8");
    }
  }

  const aiTsPath = writeAiModels(cwd, input);

  return { configPath, envPath, aiTsPath };
}

/**
 * @param source - oke.config.ts
 * @param driver - AI driver id
 */
export function upsertAiDrivers(source: string, driver: string): string {
  const block = `{
      dev: "${driver === "mock" ? "mock" : driver}",
      test: "mock",
      prod: "${driver === "mock" ? "mock" : driver}",
    }`;
  // Top-level drivers.ai only (4-space indent) — never nest under channel.email.
  const aiRe = /^( {4})ai:\s*\{[\s\S]*?\n\1\}/m;
  if (aiRe.test(source)) {
    return source.replace(aiRe, `$1ai: ${block}`);
  }
  const channelRe = /^( {4})channel:\s*\{[\s\S]*?\n\1\},?\n/m;
  if (channelRe.test(source)) {
    return source.replace(channelRe, (match) => `${match}    ai: ${block},\n`);
  }
  const driversClose = /(drivers:\s*\{[\s\S]*?)(\n\s*\},)/;
  if (!driversClose.test(source)) {
    throw new Error("oke ai setup: could not find drivers block in oke.config.ts");
  }
  return source.replace(driversClose, `$1\n    ai: ${block},$2`);
}

/**
 * @param source - Config source
 * @param key - Image role
 * @param image - Image ref
 */
export function upsertImage(source: string, key: string, image: string): string {
  const keyLit = key.includes(".") ? `"${key}"` : key;
  const line = `    ${keyLit}: "${image}",`;
  const imagesRe = /images:\s*\{([\s\S]*?)\n\s*\}/;
  const m = imagesRe.exec(source);
  if (!m) return source;
  const body = m[1]!;
  if (new RegExp(`${keyLit}\\s*:`).test(body) || new RegExp(`"${key}"\\s*:`).test(body)) {
    return source.replace(
      new RegExp(`(["']?${key.replace(".", "\\.")}["']?\\s*:\\s*)"[^"]*"`),
      `$1"${image}"`,
    );
  }
  return source.replace(imagesRe, `images: {${body}\n${line}\n  }`);
}

/** Options for {@link upsertEnv}. */
export type UpsertEnvOptions = {
  /**
   * When true, write `# KEY=value` (opt-in override). Used for AI stack keys
   * so they do not shadow `docker/.env.docker`.
   */
  readonly comment?: boolean;
};

/**
 * Insert or replace a dotenv assignment (optionally commented).
 *
 * @param env - dotenv text
 * @param key - Variable name
 * @param value - Value
 * @param options - Comment vs active line
 */
export function upsertEnv(
  env: string,
  key: string,
  value: string,
  options: UpsertEnvOptions = {},
): string {
  const line = options.comment ? `# ${key}=${value}` : `${key}=${value}`;
  const re = new RegExp(`^#?\\s*${key}=.*$`, "m");
  if (re.test(env)) return env.replace(re, line);
  const aiSection = /(# ── AI[^\n]*\n)/;
  if (aiSection.test(env)) {
    return env.replace(aiSection, `$1${line}\n`);
  }
  return `${env.trimEnd()}\n\n# ── AI ──────────────────────────────────────────────────────\n${line}\n`;
}

/**
 * @param input - Setup choices
 */
export function renderAiTs(input: AiSetupApplyInput): string {
  const chat = input.chatModel ?? "default";
  const provider =
    input.driver === "ollama"
      ? "ollama"
      : input.driver === "anthropic"
        ? "anthropic"
        : input.driver === "mock"
          ? "mock"
          : "openai-compatible";

  const lines = [
    `import { ai } from "okengine";`,
    ``,
    `/** Cloud OpenAI-compatible binding (OpenAI / Groq / OpenRouter / …). */`,
    `export const smart = ai.model("smart", {`,
    `  provider: "${provider}",`,
    `  model: process.env.OKE_AI_CLOUD_MODEL ?? process.env.OKE_AI_MODEL ?? "${chat}",`,
    `  baseUrl: process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1",`,
    `  ...(process.env.OPENAI_API_KEY?.trim()`,
    `    ? { apiKey: process.env.OPENAI_API_KEY.trim() }`,
    `    : {}),`,
    `});`,
    ``,
    `/** Local inference binding (docker llama.cpp / Ollama via \`OKE_AI_URL\`). */`,
    `export const local = ai.model("local", {`,
    `  provider: "${provider === "ollama" ? "ollama" : "openai-compatible"}",`,
    `  model: process.env.OKE_AI_LOCAL_MODEL ?? "${chat}",`,
    `  ...(process.env.OKE_AI_URL?.trim() ? { baseUrl: process.env.OKE_AI_URL.trim() } : {}),`,
    `});`,
    ``,
    `/** Advanced Notes summarize — used by \`notes.summarize\` via \`fx.ask\`. */`,
    `export const summarizeNote = smart.prompt("summarize-note", {`,
    `  via: ["smart", "local"],`,
    `  timeout: "30s",`,
    `});`,
  ];

  if (input.visionModel) {
    lines.push(
      ``,
      `export const vision = ai.model("vision", {`,
      `  provider: "${provider}",`,
      `  model: process.env.OKE_AI_VISION_MODEL ?? "${input.visionModel}",`,
      `});`,
    );
  }

  if (input.embedModel) {
    lines.push(
      ``,
      `export const embedModel = ai.model("embed", {`,
      `  provider: "${provider}",`,
      `  model: process.env.OKE_AI_EMBED_MODEL ?? "${input.embedModel}",`,
      `});`,
      ``,
      `export const docsEmbed = ai.embed("docs", { model: embedModel });`,
    );
  }

  lines.push(``);
  return `${lines.join("\n")}\n`;
}

/**
 * Write AI model declarations into `src/core.ts` (preferred) or legacy `src/core/ai.ts`.
 *
 * @param cwd - Project root
 * @param input - Setup choices
 * @returns Path written
 */
function writeAiModels(cwd: string, input: AiSetupApplyInput): string {
  const rendered = renderAiTs(input);
  const coreTsPath = join(cwd, "src", "core.ts");
  const legacyIndex = join(cwd, "src", "core", "index.ts");

  // Folder layout still in the wild — keep writing a sidecar.
  if (!existsSync(coreTsPath) && existsSync(legacyIndex)) {
    const aiTsPath = join(cwd, "src", "core", "ai.ts");
    mkdirSync(dirname(aiTsPath), { recursive: true });
    writeFileSync(aiTsPath, rendered, "utf8");
    ensureLegacyAiImported(cwd);
    return aiTsPath;
  }

  mkdirSync(dirname(coreTsPath), { recursive: true });
  if (existsSync(coreTsPath)) {
    const existing = readFileSync(coreTsPath, "utf8");
    if (hasAiModels(existing)) {
      const withPrompt = ensureSummarizeNotePrompt(existing);
      if (withPrompt !== existing) {
        writeFileSync(coreTsPath, withPrompt, "utf8");
      }
      return coreTsPath;
    }
    writeFileSync(coreTsPath, mergeAiIntoCore(existing, rendered), "utf8");
  } else {
    writeFileSync(coreTsPath, rendered, "utf8");
  }
  ensureCoreImported(cwd);
  return coreTsPath;
}

/**
 * @param source - Existing TypeScript
 */
function hasAiModels(source: string): boolean {
  return (
    /\bai\.model\s*\(/.test(source) ||
    /from\s+["']\.\/(?:core\/)?ai["']/.test(source) ||
    /import\s+["']\.\/(?:core\/)?ai["']/.test(source)
  );
}

/**
 * Append the advanced Notes `summarize-note` prompt when a `smart` model
 * exists but the prompt was never declared (common after older `--ai` runs).
 *
 * @param source - Existing `src/core.ts` (or AI sidecar) source
 */
export function ensureSummarizeNotePrompt(source: string): string {
  let next = source;
  if (
    !/\bai\.model\s*\(\s*["']local["']/.test(next) &&
    /\bai\.model\s*\(\s*["']smart["']/.test(next)
  ) {
    next = `${next.trimEnd()}

/** Local inference binding (docker llama.cpp / Ollama via \`OKE_AI_URL\`). */
export const local = ai.model("local", {
  provider: "openai-compatible",
  model: process.env.OKE_AI_LOCAL_MODEL ?? "granite3.3:2b",
  ...(process.env.OKE_AI_URL?.trim() ? { baseUrl: process.env.OKE_AI_URL.trim() } : {}),
});
`;
  }
  if (/summarize-note/.test(next) || /summarizeNote/.test(next)) {
    return next;
  }
  if (!/\bai\.model\s*\(\s*["']smart["']/.test(next)) {
    return next;
  }
  const prompt = `
/** Advanced Notes summarize — used by \`notes.summarize\` via \`fx.ask\`. */
export const summarizeNote = smart.prompt("summarize-note", {
  via: ["smart", "local"],
  timeout: "30s",
});
`;
  return `${next.trimEnd()}\n${prompt}\n`;
}

/**
 * Merge rendered AI module into an existing `src/core.ts`.
 *
 * @param existing - Current core.ts
 * @param rendered - Output of {@link renderAiTs}
 */
export function mergeAiIntoCore(existing: string, rendered: string): string {
  const body = rendered.replace(/^import\s*\{\s*ai\s*\}\s*from\s*["']okengine["'];\s*\n*/m, "");
  const next = ensureNamedOkengineImport(existing, "ai");
  return `${next.trimEnd()}\n\n${body.trimStart()}`;
}

/**
 * Ensure a named binding is imported from `"okengine"`.
 *
 * @param source - Module source
 * @param name - Binding to add
 */
export function ensureNamedOkengineImport(source: string, name: string): string {
  const re = /import\s*\{([^}]*)\}\s*from\s*["']okengine["']\s*;/;
  const m = re.exec(source);
  if (!m) {
    return `import { ${name} } from "okengine";\n${source}`;
  }
  const names = m[1]!
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.includes(name)) return source;
  const sorted = [...names, name].sort((a, b) => a.localeCompare(b));
  return source.replace(re, `import { ${sorted.join(", ")} } from "okengine";`);
}

/**
 * Ensure `src/app.ts` loads `@/core` / `./core` so merged AI registers.
 *
 * @param cwd - Project root
 */
function ensureCoreImported(cwd: string): void {
  const appPath = join(cwd, "src", "app.ts");
  if (!existsSync(appPath)) return;
  const src = readFileSync(appPath, "utf8");
  if (
    /from\s+["']@\/core["']/.test(src) ||
    /import\s+["']@\/core["']/.test(src) ||
    /from\s+["']\.\/core(?:\.ts)?["']/.test(src) ||
    /import\s+["']\.\/core(?:\.ts)?["']/.test(src)
  ) {
    return;
  }
  writeFileSync(appPath, `import "@/core";\n${src}`, "utf8");
}

/**
 * Legacy `src/core/*` layout — side-effect import the AI sidecar.
 *
 * @param cwd - Project root
 */
function ensureLegacyAiImported(cwd: string): void {
  const candidates: ReadonlyArray<{ readonly rel: string; readonly importLine: string }> = [
    { rel: "src/app.ts", importLine: `import "./core/ai";\n` },
    { rel: "src/core/index.ts", importLine: `import "./ai";\n` },
  ];
  for (const { rel, importLine } of candidates) {
    const path = join(cwd, rel);
    if (!existsSync(path)) continue;
    const src = readFileSync(path, "utf8");
    if (
      /from\s+["']\.\/(?:core\/)?ai["']/.test(src) ||
      /import\s+["']\.\/(?:core\/)?ai["']/.test(src)
    ) {
      return;
    }
    writeFileSync(path, `${importLine}${src}`, "utf8");
    return;
  }
}
