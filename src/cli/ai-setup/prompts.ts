/**
 * Interactive Clack prompts for `oke ai setup`.
 */

import { isCancel, note, select, text } from "@clack/prompts";
import {
  CHAT_MODELS,
  CLOUD_PROVIDERS,
  EMBED_MODELS,
  VISION_MODELS,
  cloudChatModels,
  recommendCloudChat,
  recommendForRole,
  type CatalogModel,
  type CloudModel,
} from "./catalog.ts";
import type { AiSetupApplyInput } from "./apply.ts";
import {
  detectOllama,
  detectTotalRamGb,
  isInstalled,
  type OllamaDetectResult,
} from "./detect-ollama.ts";
import {
  OS_HEADROOM_GB,
  fittingChatModels,
  formatMachineSummary,
  isTightFit,
  modelFitsComfortably,
  modelFitsOnMachine,
  recommendChatForNeeds,
  recommendVisionForNeeds,
  type AiNeeds,
  type AiPriority,
  type AiUseCase,
} from "./recommend.ts";

/** Provider menu value. */
export type AiSetupProvider =
  | "ollama"
  | "openai"
  | "anthropic"
  | "gemini"
  | "lmstudio"
  | "openrouter"
  | "custom";

/** Sentinel for ← Back in AI setup selects. */
const BACK = "__back__" as const;
type Back = typeof BACK;

/**
 * Run the interactive AI setup prompts.
 *
 * @param options - Preselected provider / seams
 * @returns Apply input or null on cancel
 */
export async function askAiSetup(
  options: {
    readonly provider?: string;
    readonly detect?: () => Promise<OllamaDetectResult>;
    readonly ramGb?: number | null;
  } = {},
): Promise<AiSetupApplyInput | null> {
  // Treat mock as "ask again" — create-oke may pass mock when only docker is Ollama.
  const rawProvider = options.provider?.trim() ?? "";
  let provider: AiSetupProvider | undefined =
    rawProvider === "" || rawProvider === "mock" ? undefined : (rawProvider as AiSetupProvider);

  if (!provider) {
    const value = await select({
      message: "AI Provider",
      options: [
        {
          value: "ollama",
          label: "◎  Ollama (Local)",
          hint: "detect models · recommend for your RAM",
        },
        { value: "openai", label: "◈  OpenAI" },
        { value: "anthropic", label: "◉  Anthropic" },
        { value: "gemini", label: "◇  Gemini", hint: "OpenAI-compatible proxy URL" },
        { value: "lmstudio", label: "▣  LM Studio" },
        { value: "openrouter", label: "⇄  OpenRouter" },
        { value: "custom", label: "⋯  Custom OpenAI Compatible" },
      ],
    });
    if (isCancel(value)) return null;
    provider = String(value) as AiSetupProvider;
  }

  if (provider === "ollama") {
    return askOllamaPath({
      detect: options.detect ?? detectOllama,
      ramGb: options.ramGb === undefined ? detectTotalRamGb() : options.ramGb,
    });
  }

  return askCloudPath(provider);
}

/**
 * Ollama path — needs quiz → detect panel → pick mode (with ← Back).
 *
 * @param options - Detect / RAM
 */
async function askOllamaPath(options: {
  readonly detect: () => Promise<OllamaDetectResult>;
  readonly ramGb: number | null;
}): Promise<AiSetupApplyInput | null> {
  const detected = await options.detect();
  const embedRec = recommendForRole("embed");

  // Quiz → panel → mode; ← Back from mode re-asks the quiz (same detect).
  for (;;) {
    const needs = await askAiNeedsQuiz();
    if (needs === null) return null;

    const recommended = recommendChatForNeeds(options.ramGb, needs);
    const visionRec = recommendVisionForNeeds(options.ramGb, needs.wantVision);
    const fitting = fittingChatModels(options.ramGb);
    const tooLarge = CHAT_MODELS.filter((m) => !fitting.some((f) => f.id === m.id));
    const comfortable = fitting.filter((m) => modelFitsComfortably(m, options.ramGb));
    const tight = fitting.filter((m) => isTightFit(m, options.ramGb));

    const panel = [
      formatMachineSummary(options.ramGb, recommended),
      "",
      "Detected local models",
      ...(detected.curatedInstalled.length > 0
        ? detected.curatedInstalled.map((m) => `✓ ${m.id}`)
        : ["(none from the curated list)"]),
      "",
      "Fits comfortably (leaves RAM for OS/IDE)",
      ...(comfortable.length > 0
        ? comfortable.map((m) => {
            const star = m.id === recommended.id ? " ⭐ for you" : "";
            const have = isInstalled(m.id, detected.installed) ? " · installed" : "";
            return `• ${m.id} — ≈${m.ramGb}GB-class${star}${have}`;
          })
        : ["(none — see tight fits below)"]),
    ];
    if (tight.length > 0) {
      panel.push(
        "",
        "Fits the tier but tight (little headroom)",
        ...tight.map((m) => {
          const star = m.id === recommended.id ? " ⭐ for you" : "";
          return `• ${m.id} — ≈${m.ramGb}GB-class${star}`;
        }),
      );
    }
    if (tooLarge.length > 0) {
      panel.push(
        "",
        `Too large for ~${options.ramGb ?? "?"}GB (needs a bigger machine tier)`,
        ...tooLarge.map((m) => `• ${m.id} — ≈${m.ramGb}GB-class`),
      );
    }
    panel.push(
      "",
      `Tip: Ollama download size ≪ machine RAM · keep ~${OS_HEADROOM_GB}GB free while running.`,
    );
    if (!detected.available) {
      panel.push("", "Ollama CLI/server not detected — https://ollama.com");
    }
    note(panel.join("\n"), "Ollama");

    // Inner mode loop — ← Back here returns to the quiz; Back from confirm stays here.
    for (;;) {
      const mode = await selectWithBack(
        "How do you want to pick models?",
        [
          {
            value: "recommended",
            label: "⭐  Use recommended for my answers",
            hint: `${recommended.label} · ≈${recommended.ramGb}GB-class (not your full ${options.ramGb ?? "?"}GB RAM)`,
          },
          {
            value: "installed",
            label: "✓  Use installed models",
            hint: detected.curatedInstalled.length === 0 ? "none detected" : "no download",
          },
          {
            value: "manual",
            label: "◆  Select manually",
            hint: "curated list · fit / tight labeled",
          },
        ],
        detected.curatedInstalled.some((m) => m.id === recommended.id)
          ? "installed"
          : "recommended",
        true,
      );
      if (mode === null) return null;
      if (mode === BACK) break; // outer loop → re-ask quiz

      if (mode === "recommended") {
        const pull = [recommended.id, ...(visionRec ? [visionRec.id] : []), embedRec.id].filter(
          (id) => detected.available && !isInstalled(id, detected.installed),
        );
        if (pull.length > 0 && detected.available) {
          const doPull = await selectWithBack(
            `Download ${pull.join(", ")}?`,
            [
              {
                value: "yes",
                label: "✓  Yes, download",
                hint: `${recommended.label} · ≈${recommended.ramGb}GB-class machine (pull ≪ RAM)`,
              },
              { value: "no", label: "✗  No, write ids only", hint: "pull later yourself" },
            ],
            "yes",
            true,
          );
          if (doPull === null) return null;
          if (doPull === BACK) continue;
          if (doPull === "yes") await pullModels(pull, detected.baseUrl);
        }
        return {
          driver: "ollama",
          baseUrl: detected.baseUrl,
          chatModel: recommended.id,
          visionModel: visionRec?.id ?? null,
          embedModel: embedRec.id,
        };
      }

      if (mode === "installed") {
        if (detected.curatedInstalled.length === 0) {
          note("No curated models installed — try recommended or manual.", "Ollama");
          continue;
        }
        const chat =
          detected.curatedInstalled.find(
            (m) => m.role === "chat" && modelFitsComfortably(m, options.ramGb),
          ) ??
          detected.curatedInstalled.find(
            (m) => m.role === "chat" && modelFitsOnMachine(m, options.ramGb),
          ) ??
          detected.curatedInstalled.find((m) => m.role === "chat") ??
          detected.curatedInstalled[0]!;
        const vision = needs.wantVision
          ? (detected.curatedInstalled.find((m) => m.role === "vision" && m.id !== chat.id) ??
            visionRec)
          : null;
        const embed = detected.curatedInstalled.find((m) => m.role === "embed") ?? embedRec;
        return {
          driver: "ollama",
          baseUrl: detected.baseUrl,
          chatModel: chat.id,
          visionModel: vision?.id ?? null,
          embedModel: embed.id,
        };
      }

      const manual = await askManualOllama(detected, recommended, needs, options.ramGb, true);
      if (manual === null) return null;
      if (manual === BACK) continue;
      return manual;
    }
  }
}

/**
 * Short quiz — use case + priority + vision.
 *
 * @returns Needs or null on cancel
 */
async function askAiNeedsQuiz(): Promise<AiNeeds | null> {
  const use = await selectWithBack(
    "What will you use local AI for most?",
    [
      { value: "coding", label: "◆  Coding & agents", hint: "Qwen-family tends to win" },
      { value: "general", label: "◎  General chat", hint: "Gemma / Llama" },
      { value: "reasoning", label: "◉  Reasoning", hint: "DeepSeek R1-class" },
      { value: "balanced", label: "★  Not sure — balanced", hint: "safe default for most devs" },
    ],
    "balanced",
    false,
  );
  if (use === null || use === BACK) return null;

  const priority = await selectWithBack(
    "Speed or quality?",
    [
      { value: "speed", label: "⚡  Speed", hint: "smaller model · 8GB-class" },
      { value: "balanced", label: "★  Balanced", hint: "best fit for 8–16GB machines" },
      { value: "quality", label: "◆  Quality", hint: "largest that still leaves RAM free" },
    ],
    "balanced",
    true,
  );
  if (priority === null) return null;
  if (priority === BACK) return askAiNeedsQuiz();

  const vision = await selectWithBack(
    "Need a vision model (images)?",
    [
      { value: "yes", label: "✓  Yes", hint: "adds a small VL model if RAM allows" },
      { value: "no", label: "✗  No", hint: "chat + embed only" },
    ],
    "no",
    true,
  );
  if (vision === null) return null;
  if (vision === BACK) return askAiNeedsQuiz();

  return {
    useCase: use as AiUseCase,
    priority: priority as AiPriority,
    wantVision: vision === "yes",
  };
}

/**
 * Manual chat → vision → embed (models that fit listed first).
 *
 * @param detected - Detect result
 * @param recommended - Recommended chat
 * @param needs - Quiz answers (vision optional)
 * @param ramGb - Machine RAM
 * @param allowBack - Offer ← Back to mode menu
 */
async function askManualOllama(
  detected: OllamaDetectResult,
  recommended: CatalogModel,
  needs: AiNeeds,
  ramGb: number | null,
  allowBack: boolean,
): Promise<AiSetupApplyInput | Back | null> {
  const ordered = [
    ...fittingChatModels(ramGb),
    ...CHAT_MODELS.filter((m) => !modelFitsOnMachine(m, ramGb)),
  ];
  const seen = new Set<string>();
  const chatList = ordered.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  let chat = recommended.id;
  let vision: string | null | undefined = needs.wantVision
    ? (recommendVisionForNeeds(ramGb, true)?.id ?? recommendForRole("vision").id)
    : null;

  while (true) {
    const chatPick = await pickModel(
      "Select Chat Model",
      chatList,
      chat,
      false,
      false,
      allowBack,
      ramGb,
    );
    if (chatPick === null) return null;
    if (chatPick === BACK) return BACK;
    if (typeof chatPick !== "string") continue;
    chat = chatPick;

    if (needs.wantVision) {
      const visionPick = await pickModel(
        "Vision Model",
        VISION_MODELS,
        vision ?? recommendForRole("vision").id,
        false,
        true,
        true,
        ramGb,
      );
      if (visionPick === null) return null;
      if (visionPick === BACK) continue;
      vision = visionPick === undefined ? null : visionPick;
    }

    const embedPick = await pickModel(
      "Embedding Model",
      EMBED_MODELS,
      recommendForRole("embed").id,
      false,
      false,
      true,
      ramGb,
    );
    if (embedPick === null) return null;
    if (embedPick === BACK) continue;
    if (typeof embedPick !== "string") continue;

    const needed = [chat, ...(typeof vision === "string" ? [vision] : []), embedPick].filter(
      (id) => detected.available && !isInstalled(id, detected.installed),
    );
    if (needed.length > 0 && detected.available) {
      const doPull = await selectWithBack(
        `Download missing (${needed.join(", ")})?`,
        [
          { value: "yes", label: "✓  Yes", hint: "pull size ≪ machine RAM" },
          { value: "no", label: "✗  No" },
        ],
        "yes",
        true,
      );
      if (doPull === null) return null;
      if (doPull === BACK) continue;
      if (doPull === "yes") await pullModels(needed, detected.baseUrl);
    }

    return {
      driver: "ollama",
      baseUrl: detected.baseUrl,
      chatModel: chat,
      visionModel: typeof vision === "string" ? vision : null,
      embedModel: embedPick,
    };
  }
}

/**
 * Select with optional trailing ← Back.
 */
async function selectWithBack(
  message: string,
  options: readonly { value: string; label: string; hint?: string }[],
  initialValue: string,
  allowBack: boolean,
): Promise<string | Back | null> {
  const list = [...options, ...(allowBack ? [{ value: BACK, label: "←  Back" }] : [])];
  const value = await select({ message, options: list, initialValue });
  if (isCancel(value)) return null;
  const picked = String(value);
  if (picked === BACK) return BACK;
  return picked;
}

/**
 * Cloud / openai-compatible path — curated models + Other (type id).
 *
 * @param provider - Menu provider
 */
async function askCloudPath(provider: AiSetupProvider): Promise<AiSetupApplyInput | null> {
  const meta = CLOUD_PROVIDERS.find((p) => p.value === provider);
  const driver = meta?.driver ?? "openai-compatible";

  let baseUrl: string | undefined = meta?.baseUrl;
  if (provider === "custom" || provider === "gemini" || !baseUrl) {
    const urlValue = await text({
      message:
        provider === "gemini"
          ? "OpenAI-compatible base URL for Gemini"
          : "OpenAI-compatible base URL",
      placeholder: baseUrl ?? "https://api.example.com/v1",
      initialValue: baseUrl ?? "",
    });
    if (isCancel(urlValue)) return null;
    const trimmed = String(urlValue).trim();
    baseUrl = trimmed.length > 0 ? trimmed : undefined;
  }

  const models = cloudChatModels(provider);
  const chat = await pickCloudModel("Select Chat Model", models, recommendCloudChat(provider));
  if (chat === null) return null;

  const apiKeyEnv = driver === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";

  return {
    driver,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    chatModel: chat,
    visionModel: null,
    embedModel: null,
    apiKeyEnv,
  };
}

/**
 * Format a catalog row — for Ollama, annotate fit vs too-large.
 *
 * @param m - Catalog / cloud model
 * @param ramGb - Machine RAM (ollama only)
 * @param recommendedId - Id marked "for you"
 */
function catalogOption(
  m: CatalogModel | CloudModel,
  ramGb: number | null = null,
  recommendedId?: string,
): { value: string; label: string; hint: string } {
  const isRec = m.recommended || m.id === recommendedId;
  if ("ramGb" in m && typeof m.ramGb === "number") {
    const onMachine = modelFitsOnMachine(m, ramGb);
    const comfortable = modelFitsComfortably(m, ramGb);
    const fitLabel = !onMachine
      ? "too large for this machine"
      : comfortable
        ? "fits comfortably"
        : "tight fit";
    return {
      value: m.id,
      label: isRec ? `⭐  ${m.label} (for you)` : `   ${m.label}`,
      hint: `${m.hint} · ${fitLabel}`,
    };
  }
  return {
    value: m.id,
    label: isRec ? `⭐  ${m.label} (Recommended)` : `   ${m.label}`,
    hint: m.hint,
  };
}

const OTHER_MODEL = "__other__";

/**
 * Ask for a custom model id when the user picks Other.
 *
 * @param placeholder - Example id
 */
async function askOtherModelId(placeholder: string): Promise<string | null> {
  const value = await text({
    message: "Model id",
    placeholder,
    initialValue: "",
    validate: (v) => {
      if (!v?.trim()) return "Model id is required";
      return undefined;
    },
  });
  if (isCancel(value)) return null;
  return String(value).trim();
}

/**
 * Pick from a curated cloud list + Other (type any id).
 *
 * @param message - Prompt
 * @param models - Curated list
 * @param initial - Default id
 */
async function pickCloudModel(
  message: string,
  models: readonly CloudModel[],
  initial: string,
): Promise<string | null> {
  const options: { value: string; label: string; hint?: string }[] = [
    ...models.map((m) => catalogOption(m)),
    {
      value: OTHER_MODEL,
      label: "⋯  Other…",
      hint: "type any model id",
    },
  ];
  const initialValue = models.some((m) => m.id === initial) ? initial : OTHER_MODEL;
  const value = await select({
    message,
    options,
    initialValue,
  });
  if (isCancel(value)) return null;
  const picked = String(value);
  if (picked === OTHER_MODEL) {
    return askOtherModelId(initial || "model-id");
  }
  return picked;
}

/**
 * Pick from a curated list, with optional Show all + Skip + Other + Back.
 *
 * @returns model id, null cancel, undefined skip, BACK
 */
async function pickModel(
  message: string,
  models: readonly CatalogModel[],
  initial: string,
  showAllHint: boolean,
  allowSkip = false,
  allowBack = false,
  ramGb: number | null = null,
): Promise<string | Back | null | undefined> {
  const short = models.slice(0, 5);
  const options: { value: string; label: string; hint?: string }[] = short.map((m) =>
    catalogOption(m, ramGb, initial),
  );
  if (showAllHint && models.length > short.length) {
    options.push({ value: "__all__", label: "⋯  Show all models", hint: "full curated catalog" });
  }
  options.push({
    value: OTHER_MODEL,
    label: "⋯  Other…",
    hint: "type any model id",
  });
  if (allowSkip) {
    options.push({ value: "__skip__", label: "⊘  Skip", hint: "no vision model" });
  }
  if (allowBack) {
    options.push({ value: BACK, label: "←  Back" });
  }

  const value = await select({
    message,
    options,
    initialValue: models.some((m) => m.id === initial) ? initial : short[0]?.id,
  });
  if (isCancel(value)) return null;
  const picked = String(value);
  if (picked === BACK) return BACK;
  if (picked === "__skip__") return undefined;
  if (picked === OTHER_MODEL) {
    return askOtherModelId(initial);
  }
  if (picked === "__all__") {
    const allOptions = [
      ...models.map((m) => catalogOption(m, ramGb, initial)),
      { value: OTHER_MODEL, label: "⋯  Other…", hint: "type any model id" },
      ...(allowSkip ? [{ value: "__skip__", label: "⊘  Skip", hint: "no vision model" }] : []),
      ...(allowBack ? [{ value: BACK, label: "←  Back" }] : []),
    ];
    const allValue = await select({
      message,
      options: allOptions,
      initialValue: initial,
    });
    if (isCancel(allValue)) return null;
    const allPicked = String(allValue);
    if (allPicked === BACK) return BACK;
    if (allPicked === "__skip__") return undefined;
    if (allPicked === OTHER_MODEL) return askOtherModelId(initial);
    return allPicked;
  }
  return picked;
}

/**
 * Pull each model via the Ollama HTTP API (`POST /api/pull`) — never a host
 * `ollama` CLI (that may hit a different local installation than the URL).
 *
 * @param models - Model ids
 * @param baseUrl - Ollama server base URL
 */
async function pullModels(models: readonly string[], baseUrl: string): Promise<void> {
  const { ensureOllamaModel } = await import("../../docker/ollama-pull.ts");
  for (const id of models) {
    console.log(`ollama: pulling ${id} via ${baseUrl}/api/pull…`);
    try {
      await ensureOllamaModel({ url: baseUrl, model: id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`oke ai setup: pull ${id} failed (continuing) — ${msg}`);
    }
  }
}
