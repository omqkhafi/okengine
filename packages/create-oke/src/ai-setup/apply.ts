/**
 * Write AI driver config, env, and `src/core/ai.ts` for `oke ai setup`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { OLLAMA_IMAGE } from "../drivers-catalog.ts";
import { extractImages, findImagesBlock, replaceImagesBlock } from "../transform.ts";

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
  // Driver / URL stay commented so docker mode can hydrate `OKE_AI_URL` from
  // `docker/.env.docker` without being shadowed. The selected chat model is
  // written active — `oke dev` seeds it into stack controls / `LLAMA_ARG_DOCKER_REPO`
  // (commented-only left the compose default `smollm2` forever).
  env = upsertEnv(env, "OKE_AI_DRIVER", input.driver, { comment: true });
  if (input.baseUrl) env = upsertEnv(env, "OKE_AI_URL", input.baseUrl, { comment: true });
  if (input.chatModel) env = upsertEnv(env, "OKE_AI_MODEL", input.chatModel);
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

  const aiTsPath = join(cwd, "src", "core", "ai.ts");
  mkdirSync(dirname(aiTsPath), { recursive: true });
  writeFileSync(aiTsPath, renderAiTs(input), "utf8");
  ensureAiImported(cwd);

  return { configPath, envPath, aiTsPath };
}

/**
 * @param source - oke.config.ts
 * @param driver - AI driver id
 */
export function upsertAiDrivers(source: string, driver: string): string {
  const block = `{
      local: "${driver}",
      docker: "${driver === "mock" ? "mock" : driver}",
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
 * Set one dotted role's image pin, preserving every other pin (including
 * `store.*` / `channel.*` nesting) via {@link extractImages} /
 * {@link replaceImagesBlock} — a parse/set/render round-trip rather than a
 * single-line regex, so nested sub-objects are never corrupted.
 *
 * @param source - Config source
 * @param key - Image role (dotted for `store.*` / `channel.*`, flat otherwise)
 * @param image - Image ref
 */
export function upsertImage(source: string, key: string, image: string): string {
  if (!findImagesBlock(source)) return source;
  const images = { ...extractImages(source), [key]: image };
  return replaceImagesBlock(source, images);
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
    `export const smart = ai.model("smart", {`,
    `  provider: "${provider}",`,
    `  model: process.env.OKE_AI_MODEL ?? "${chat}",`,
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
 * Ensure `src/app.ts` or `src/core/index.ts` imports `./core/ai` / `./ai`.
 *
 * @param cwd - Project root
 */
function ensureAiImported(cwd: string): void {
  const candidates: ReadonlyArray<{ readonly rel: string; readonly importLine: string }> = [
    { rel: "src/app.ts", importLine: `import "./core/ai";\n` },
    { rel: "src/core/index.ts", importLine: `import "./ai";\n` },
    // Legacy layout
    { rel: "src/core.ts", importLine: `import "./ai";\n` },
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
