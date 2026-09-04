/**
 * Write AI driver config, env, and AI models into `src/core.ts` for `oke ai setup`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAiProviderEntry } from "../../elements/ai/providers.ts";

/** Choices applied to the project. */
export type AiSetupApplyInput = {
  readonly driver: "anthropic" | "openai-compatible" | "mock";
  /**
   * Name written to `ai.model({ provider })` — registry id (`openrouter`,
   * `openai`, …), or `openai-compatible` / `local` for self-hosted.
   */
  readonly provider?: string;
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
    } else {
      // Cloud / host-side providers must not leave a leftover local AI image —
      // Compose would still start llama.cpp/Ollama for OpenRouter etc.
      config = removeImage(config, "ai");
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
  // Driver / URL / model stay commented so `oke dev --docker` can write
  // the live compose URL into `.env.local` without a leftover pin winning.
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

/**
 * Drop one flat image role pin (e.g. clear `images.ai` for cloud AI).
 *
 * @param source - Config source
 * @param key - Image role (`ai`, `pgdog`, … — not nested `store.*`)
 */
export function removeImage(source: string, key: string): string {
  const keyLit = key.includes(".") ? `"${key}"` : key;
  const lineRe = new RegExp(`\\n[ \\t]*${keyLit}\\s*:\\s*"[^"]*",?`);
  if (!lineRe.test(source)) return source;
  return source.replace(lineRe, "");
}

/** Options for {@link upsertEnv}. */
export type UpsertEnvOptions = {
  /**
   * When true, write `# KEY=value` (opt-in override). Used for AI stack keys
   * so `oke dev --docker` can write the live compose URL into `.env.local`.
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
  const provider = resolveDeclProvider(input);
  const apiKeyEnv = input.apiKeyEnv;
  const registryCloud = isRegistryCloudProvider(provider);
  const nativeAnthropic = input.driver === "anthropic";
  const localPrimary = isSelfHostedLocal(input);

  const smartLines = [
    `export const smart = ai.model("smart", {`,
    `  provider: "${provider}",`,
    ...(nativeAnthropic ? [`  driverId: "anthropic",`] : []),
    `  model: process.env.OKE_AI_CLOUD_MODEL ?? process.env.OKE_AI_MODEL ?? "${chat}",`,
    ...smartBaseUrlLines(input, { registryCloud, localPrimary }),
    ...apiKeySpreadLines(apiKeyEnv),
    `});`,
  ];

  const localProvider = "openai-compatible";
  const localDefaultModel = localPrimary ? chat : "granite3.3:2b";
  const localLines = [
    `export const local = ai.model("local", {`,
    `  provider: "${localProvider}",`,
    `  model: process.env.OKE_AI_LOCAL_MODEL ?? "${localDefaultModel}",`,
    `  ...(process.env.OKE_AI_URL?.trim() ? { baseUrl: process.env.OKE_AI_URL.trim() } : {}),`,
    `});`,
  ];

  const lines = [
    `import { ai } from "okengine";`,
    ``,
    `/** Primary model binding (${provider}). */`,
    ...smartLines,
    ``,
    `/** Local inference binding (docker llama.cpp / Ollama via \`OKE_AI_URL\`). */`,
    ...localLines,
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
      ...(nativeAnthropic ? [`  driverId: "anthropic",`] : []),
      `  model: process.env.OKE_AI_VISION_MODEL ?? "${input.visionModel}",`,
      ...apiKeySpreadLines(apiKeyEnv),
      `});`,
    );
  }

  if (input.embedModel) {
    lines.push(
      ``,
      `export const embedModel = ai.model("embed", {`,
      `  provider: "${provider}",`,
      `  model: process.env.OKE_AI_EMBED_MODEL ?? "${input.embedModel}",`,
      ...apiKeySpreadLines(apiKeyEnv),
      `});`,
      ``,
      `export const docsEmbed = ai.embed("docs", { model: embedModel });`,
    );
  }

  lines.push(``);
  return `${lines.join("\n")}\n`;
}

/**
 * Provider string for generated `ai.model` declarations.
 *
 * @param input - Setup choices
 */
export function resolveDeclProvider(input: AiSetupApplyInput): string {
  if (input.provider !== undefined && input.provider.length > 0) return input.provider;
  if (input.driver === "anthropic") return "anthropic";
  if (input.driver === "mock") return "mock";
  return "openai-compatible";
}

function isRegistryCloudProvider(provider: string): boolean {
  return getAiProviderEntry(provider) !== undefined;
}

function isSelfHostedLocal(input: AiSetupApplyInput): boolean {
  return input.image !== undefined;
}

function smartBaseUrlLines(
  input: AiSetupApplyInput,
  flags: { readonly registryCloud: boolean; readonly localPrimary: boolean },
): string[] {
  if (input.driver === "anthropic") {
    return [];
  }
  if (flags.registryCloud) {
    // Registry auto-resolves; optional env override for proxies/mirrors.
    return [
      `  ...(process.env.OPENAI_BASE_URL?.trim() ? { baseUrl: process.env.OPENAI_BASE_URL.trim() } : {}),`,
    ];
  }
  if (flags.localPrimary) {
    return [
      `  ...(process.env.OKE_AI_URL?.trim() ? { baseUrl: process.env.OKE_AI_URL.trim() } : {}),`,
    ];
  }
  // custom / lmstudio — prefer OPENAI_BASE_URL, fall back to setup-time URL when present
  if (input.baseUrl) {
    return [
      `  baseUrl: process.env.OPENAI_BASE_URL?.trim() || ${JSON.stringify(input.baseUrl)},`,
    ];
  }
  return [
    `  ...(process.env.OPENAI_BASE_URL?.trim() ? { baseUrl: process.env.OPENAI_BASE_URL.trim() } : {}),`,
  ];
}

function apiKeySpreadLines(apiKeyEnv: string | undefined): string[] {
  if (!apiKeyEnv) return [];
  return [
    `  ...(process.env.${apiKeyEnv}?.trim()`,
    `    ? { apiKey: process.env.${apiKeyEnv}.trim() }`,
    `    : {}),`,
  ];
}

/**
 * Write AI model declarations into `src/core/ai.ts` when that split exists
 * (so a thin `src/core.ts` barrel stays a re-export), else `src/core.ts`,
 * else legacy `src/core/index.ts` + sidecar.
 *
 * @param cwd - Project root
 * @param input - Setup choices
 * @returns Path written
 */
function writeAiModels(cwd: string, input: AiSetupApplyInput): string {
  const rendered = renderAiTs(input);
  const coreAiPath = join(cwd, "src", "core", "ai.ts");
  const coreTsPath = join(cwd, "src", "core.ts");
  const legacyIndex = join(cwd, "src", "core", "index.ts");

  if (existsSync(coreAiPath)) {
    const existing = readFileSync(coreAiPath, "utf8");
    writeFileSync(coreAiPath, resolveAiCoreSource(existing, rendered), "utf8");
    ensureCoreBarrelExportsAi(cwd);
    ensureCoreImported(cwd);
    return coreAiPath;
  }

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
    writeFileSync(coreTsPath, resolveAiCoreSource(existing, rendered), "utf8");
  } else {
    writeFileSync(coreTsPath, rendered, "utf8");
  }
  ensureCoreImported(cwd);
  return coreTsPath;
}

/**
 * Decide whether to merge a full AI module, repair a broken stub, or only
 * backfill `local` / `summarizeNote` on an already-complete core.
 *
 * @param existing - Current core / AI sidecar source
 * @param rendered - Output of {@link renderAiTs}
 */
export function resolveAiCoreSource(existing: string, rendered: string): string {
  if (isIncompleteAiSetup(existing)) {
    return mergeAiIntoCore(stripIncompleteAiExports(existing), rendered);
  }
  if (hasAiModels(existing)) {
    return ensureSummarizeNotePrompt(existing);
  }
  return mergeAiIntoCore(existing, rendered);
}

/**
 * @param source - Existing TypeScript
 */
function hasAiModels(source: string): boolean {
  // Require real exports — template comments like `//   ai.model("smart", …)`
  // must not look like an already-configured core.
  return (
    /\bexport\s+const\s+(?:smart|local|vision|embedModel)\s*=\s*ai\.model\s*\(/.test(source) ||
    /from\s+["']\.\/(?:core\/)?ai["']/.test(source) ||
    /import\s+["']\.\/(?:core\/)?ai["']/.test(source)
  );
}

/**
 * True when prior AI setup left unusable stubs (e.g. `local` + `summarizeNote`
 * without `smart` / without an `ai` import — the old comment-as-configured bug).
 *
 * @param source - Existing TypeScript
 */
export function isIncompleteAiSetup(source: string): boolean {
  const hasAiImport = /import\s*\{[^}]*\bai\b[^}]*\}\s*from\s*["']okengine["']/.test(source);
  const hasSmart = /\bexport\s+const\s+smart\s*=\s*ai\.model\s*\(/.test(source);
  const hasLocal = /\bexport\s+const\s+local\s*=\s*ai\.model\s*\(/.test(source);
  const hasSummarize = /\bexport\s+const\s+summarizeNote\s*=/.test(source);
  const hasAnyModel =
    /\bexport\s+const\s+(?:smart|local|vision|embedModel)\s*=\s*ai\.model\s*\(/.test(source);
  if (hasAnyModel && !hasAiImport) return true;
  if ((hasLocal || hasSummarize) && !hasSmart) return true;
  return false;
}

/**
 * Remove partial AI exports so {@link mergeAiIntoCore} can rewrite a full set.
 *
 * @param source - Existing TypeScript
 */
export function stripIncompleteAiExports(source: string): string {
  let next = source;
  next = next.replace(
    /(?:\/\*\*[^*]*\*+(?:[^/*][^*]*\*+)*\/\s*)?export\s+const\s+local\s*=\s*ai\.model\s*\(\s*["']local["']\s*,\s*\{[\s\S]*?\}\s*\)\s*;\s*/g,
    "",
  );
  next = next.replace(
    /(?:\/\*\*[^*]*\*+(?:[^/*][^*]*\*+)*\/\s*)?export\s+const\s+summarizeNote\s*=\s*smart\.prompt\s*\([\s\S]*?\}\s*\)\s*;\s*/g,
    "",
  );
  if (!/\bexport\s+const\s+smart\s*=\s*ai\.model\s*\(/.test(next)) {
    next = next.replace(
      /(?:\/\*\*[^*]*\*+(?:[^/*][^*]*\*+)*\/\s*)?export\s+const\s+(?:vision|embedModel)\s*=\s*ai\.model\s*\([\s\S]*?\}\s*\)\s*;\s*/g,
      "",
    );
    next = next.replace(
      /(?:\/\*\*[^*]*\*+(?:[^/*][^*]*\*+)*\/\s*)?export\s+const\s+docsEmbed\s*=\s*ai\.embed\s*\([\s\S]*?\}\s*\)\s*;\s*/g,
      "",
    );
  }
  return next.replace(/\n{3,}/g, "\n\n");
}

/**
 * Append the advanced Notes `summarize-note` prompt when a `smart` model
 * exists but the prompt was never declared (common after older `--ai` runs).
 *
 * @param source - Existing `src/core.ts` (or AI sidecar) source
 */
export function ensureSummarizeNotePrompt(source: string): string {
  let next = source;
  const hasSmartExport = /\bexport\s+const\s+smart\s*=/.test(next);
  const hasLocalExport = /\bexport\s+const\s+local\s*=/.test(next);
  if (!hasLocalExport && hasSmartExport) {
    next = `${next.trimEnd()}

/** Local inference binding (docker llama.cpp / Ollama via \`OKE_AI_URL\`). */
export const local = ai.model("local", {
  provider: "openai-compatible",
  model: process.env.OKE_AI_LOCAL_MODEL ?? "granite3.3:2b",
  ...(process.env.OKE_AI_URL?.trim() ? { baseUrl: process.env.OKE_AI_URL.trim() } : {}),
});
`;
  }
  const hasSummarizeExport =
    /\bexport\s+const\s+summarizeNote\s*=/.test(next) ||
    /\.prompt\s*\(\s*["']summarize-note["']/.test(next);
  if (hasSummarizeExport) {
    return next === source ? next : ensureNamedOkengineImport(next, "ai");
  }
  if (!hasSmartExport) {
    return next;
  }
  const prompt = `
/** Advanced Notes summarize — used by \`notes.summarize\` via \`fx.ask\`. */
export const summarizeNote = smart.prompt("summarize-note", {
  via: ["smart", "local"],
  timeout: "30s",
});
`;
  return ensureNamedOkengineImport(`${next.trimEnd()}\n${prompt}\n`, "ai");
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
 * Keep a `src/core.ts` barrel re-exporting `./core/ai.ts` after a split write.
 *
 * @param cwd - Project root
 */
function ensureCoreBarrelExportsAi(cwd: string): void {
  const coreTsPath = join(cwd, "src", "core.ts");
  if (!existsSync(coreTsPath)) return;
  const src = readFileSync(coreTsPath, "utf8");
  if (/from\s+["']\.\/core\/ai/.test(src)) return;
  writeFileSync(coreTsPath, `${src.trimEnd()}\nexport * from "./core/ai.ts";\n`, "utf8");
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
