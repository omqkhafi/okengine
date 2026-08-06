/**
 * Customize wizard — pick local|docker first, walk facets for that side,
 * then ask whether to customize the other (defaults if no).
 */

import { confirm, isCancel } from "@clack/prompts";
import { toCreateDefaults, type CreateDefaults, type EnvDriverPins } from "./create-defaults.ts";
import {
  CLOCK_CHOICES,
  EMAIL_CHOICES,
  FILES_CHOICES,
  INDEX_CHOICES,
  KV_CHOICES,
  SIGNAL_CHOICES,
  SQL_CHOICES,
  TEMPLATE_DOCKER_PROD,
  TEMPLATE_LOCAL,
  TEMPLATE_TEST,
  VAULT_CHOICES,
  AI_PROVIDERS,
  LLAMA_CPP_IMAGE,
  OLLAMA_IMAGE,
  SGLANG_IMAGE,
  VLLM_IMAGE,
  aiDriverForProvider,
  customizeFacetsFor,
  pinsDockerReady,
  pinsLocalOnly,
  type AiProviderId,
  type CustomizeFacetId,
  type DriverChoice,
} from "./drivers-catalog.ts";
import type { AiSetupApplyInput } from "./ai-setup/apply.ts";
import { aiPrefWithModels } from "./ai-setup/from-pref.ts";
import { askAiSetup } from "./ai-setup/prompts.ts";
import type { TemplateId } from "./templates.ts";
import { WIZARD_BACK, selectWithBack, type WizardBack } from "./wizard-select.ts";

export type { WizardBack };
export { WIZARD_BACK };

/** Dev env column being customized. */
export type CustomizeSide = "local" | "docker";

/** Partial pins accumulated per side before merge. */
export type SidePins = {
  sql?: string;
  kv?: string;
  files?: string;
  /** Driver id, or `"none"` / unset for no store.index. */
  index?: string | null;
  signal?: string;
  clock?: string;
  vault?: string;
  email?: string;
};

/**
 * Merge primary + other side into full {@link EnvDriverPins}.
 *
 * @param local - Local driver
 * @param docker - Docker driver (copied to prod)
 * @param test - Test pin
 */
export function pinsFromSides(local: string, docker: string, test: string): EnvDriverPins {
  return { local, docker, test, prod: docker };
}

/**
 * Whether a side pin enables store.index.
 *
 * @param value - Picked driver or none
 */
function indexEnabled(value: string | null | undefined): value is string {
  return typeof value === "string" && value !== "none";
}

/**
 * Fill missing side from template defaults.
 *
 * @param side - Side that was customized
 * @param picked - Values chosen for that side
 * @param other - Optional values if the user also customized the other side
 */
export function assembleDriverDefaults(
  side: CustomizeSide,
  picked: SidePins,
  other: SidePins | null,
): CreateDefaults["drivers"] {
  const localSrc = side === "local" ? picked : (other ?? {});
  const dockerSrc = side === "docker" ? picked : (other ?? {});

  const sql = pinsFromSides(
    localSrc.sql ?? TEMPLATE_LOCAL.sql,
    dockerSrc.sql ?? TEMPLATE_DOCKER_PROD.sql,
    TEMPLATE_TEST.sql,
  );
  const kv = pinsFromSides(
    localSrc.kv ?? TEMPLATE_LOCAL.kv,
    dockerSrc.kv ?? TEMPLATE_DOCKER_PROD.kv,
    TEMPLATE_TEST.kv,
  );
  const files = pinsFromSides(
    localSrc.files ?? TEMPLATE_LOCAL.files,
    dockerSrc.files ?? TEMPLATE_DOCKER_PROD.files,
    TEMPLATE_TEST.files,
  );
  const indexLocal = localSrc.index;
  const indexDocker = dockerSrc.index;
  const index =
    indexEnabled(indexLocal) || indexEnabled(indexDocker)
      ? pinsFromSides(
          indexEnabled(indexLocal) ? indexLocal : "memory",
          indexEnabled(indexDocker) ? indexDocker : "meilisearch",
          "memory",
        )
      : null;

  return {
    store: { sql, kv, files, index },
    signal: pinsFromSides(
      localSrc.signal ?? TEMPLATE_LOCAL.signal,
      dockerSrc.signal ?? TEMPLATE_DOCKER_PROD.signal,
      TEMPLATE_TEST.signal,
    ),
    clock: pinsFromSides(
      localSrc.clock ?? TEMPLATE_LOCAL.clock,
      dockerSrc.clock ?? TEMPLATE_DOCKER_PROD.clock,
      TEMPLATE_TEST.clock,
    ),
    vault: pinsFromSides(
      localSrc.vault ?? TEMPLATE_LOCAL.vault,
      dockerSrc.vault ?? TEMPLATE_DOCKER_PROD.vault,
      TEMPLATE_TEST.vault,
    ),
    channel: {
      email: pinsFromSides(
        localSrc.email ?? TEMPLATE_LOCAL.email,
        dockerSrc.email ?? TEMPLATE_DOCKER_PROD.email,
        TEMPLATE_TEST.email,
      ),
    },
    ai: null,
  };
}

/**
 * Balanced llama.cpp defaults for "AI setup → Recommended" (no quiz).
 * Lightest local footprint; curated Docker Hub `ai/` model via docker-repo.
 */
export function recommendedAiApply(): AiSetupApplyInput {
  return {
    driver: "openai-compatible",
    baseUrl: process.env.OKE_AI_URL ?? "http://127.0.0.1:8080/v1",
    chatModel: "smollm2",
    visionModel: null,
    embedModel: null,
    image: LLAMA_CPP_IMAGE,
  };
}

/**
 * Attach the compose image pin for a local/self-hosted AI provider menu id.
 *
 * @param input - Apply input from prompts
 * @param provider - Menu provider id
 */
export function withLocalAiImage(input: AiSetupApplyInput, provider: string): AiSetupApplyInput {
  if (provider === "llama-cpp") {
    return {
      ...input,
      image: LLAMA_CPP_IMAGE,
      baseUrl: input.baseUrl ?? "http://127.0.0.1:8080/v1",
    };
  }
  if (provider === "ollama") {
    return { ...input, image: OLLAMA_IMAGE };
  }
  if (provider === "vllm") {
    return {
      ...input,
      image: VLLM_IMAGE,
      baseUrl: input.baseUrl ?? "http://127.0.0.1:8000/v1",
    };
  }
  if (provider === "sglang") {
    return {
      ...input,
      image: SGLANG_IMAGE,
      baseUrl: input.baseUrl ?? "http://127.0.0.1:30000/v1",
    };
  }
  return input;
}

/**
 * Customize drivers for one template.
 *
 * @param template - Starter id (filters facets)
 */
export async function askCustomizeFlow(
  template: TemplateId,
): Promise<CreateDefaults | WizardBack | null> {
  const primaryValue = await selectWithBack(
    "Customize drivers for",
    [
      {
        value: "local",
        label: "Local",
        hint: "oke mode local — sqlite / memory / fs …",
      },
      {
        value: "docker",
        label: "Docker",
        hint: "oke mode docker — postgres / redis / s3 …",
      },
    ],
    template === "advanced" ? "docker" : "local",
    { allowBack: true },
  );
  if (primaryValue === null) return null;
  if (primaryValue === WIZARD_BACK) return WIZARD_BACK;
  const primary = primaryValue as CustomizeSide;

  const facets = customizeFacetsFor(template);
  const primaryPins = await walkFacetsForSide(facets, primary);
  if (primaryPins === null) return null;
  if (primaryPins === WIZARD_BACK) return WIZARD_BACK;

  const otherSide: CustomizeSide = primary === "local" ? "docker" : "local";
  const alsoOther = await confirm({
    message:
      otherSide === "local" ? "Also customize local drivers?" : "Also customize docker drivers?",
    initialValue: false,
  });
  if (isCancel(alsoOther)) return null;

  let otherPins: SidePins | null = null;
  if (alsoOther) {
    const walked = await walkFacetsForSide(facets, otherSide);
    if (walked === null) return null;
    if (walked === WIZARD_BACK) {
      // Back from other side → treat as "no, use defaults"
      otherPins = null;
    } else {
      otherPins = walked;
    }
  }

  const drivers = assembleDriverDefaults(primary, primaryPins, otherPins);
  const profile = primary === "docker" ? "docker-ready" : "local-only";

  // AI — after env passes
  let aiPins: EnvDriverPins | null = null;
  let aiPref: CreateDefaults["ai"] = { enabled: false, provider: null, driver: null };
  let aiApply: AiSetupApplyInput | null = null;

  aiSetup: for (;;) {
    const aiSetup = await selectWithBack(
      "AI setup",
      [
        {
          value: "recommended",
          label: "Recommended",
          hint: "llama.cpp · lightest local footprint",
        },
        {
          value: "customize",
          label: "Customize",
          hint: "pick provider & models",
        },
        {
          value: "off",
          label: "Off",
          hint: "no AI drivers",
        },
      ],
      "recommended",
      { allowBack: true },
    );
    if (aiSetup === null) return null;
    if (aiSetup === WIZARD_BACK) {
      // Back from AI → leave AI off (same as Off) and finish customize.
      break;
    }
    if (aiSetup === "off") break;
    if (aiSetup === "recommended") {
      aiPins =
        primary === "local" && !alsoOther
          ? pinsLocalOnly("openai-compatible", "openai-compatible", "mock")
          : pinsDockerReady("openai-compatible", "openai-compatible", "mock");
      aiApply = recommendedAiApply();
      aiPref = aiPrefWithModels(
        {
          enabled: true,
          provider: "llama-cpp",
          driver: "openai-compatible",
        },
        aiApply,
      );
      break;
    }

    // customize — local provider, optional docker provider, then model wizard
    const options = AI_PROVIDERS.map((p) => ({ value: p.value, label: p.label }));
    providers: for (;;) {
      const askDockerAi = primary === "docker" || alsoOther;
      const localProviderValue = await selectWithBack(
        askDockerAi || primary === "local" ? "AI Provider — local" : "AI Provider",
        options,
        "llama-cpp",
        { allowBack: true },
      );
      if (localProviderValue === null) return null;
      if (localProviderValue === WIZARD_BACK) continue aiSetup;

      const localProvider = localProviderValue as AiProviderId;
      const localDriver = aiDriverForProvider(localProvider);
      let dockerDriver = localDriver === "mock" ? "mock" : localDriver;
      let dockerProvider: AiProviderId = localProvider;

      if (askDockerAi) {
        const dockerProviderValue = await selectWithBack(
          "AI Provider — docker",
          options,
          "llama-cpp",
          { allowBack: true },
        );
        if (dockerProviderValue === null) return null;
        if (dockerProviderValue === WIZARD_BACK) continue providers;
        dockerProvider = dockerProviderValue as AiProviderId;
        dockerDriver = aiDriverForProvider(dockerProvider);
        if (dockerDriver === "mock") dockerDriver = "mock";
      }

      aiPins =
        primary === "local" && !alsoOther
          ? pinsLocalOnly(localDriver, dockerDriver, "mock")
          : pinsDockerReady(localDriver, dockerDriver, "mock");

      const setupProvider =
        localProvider === "ollama" || aiPins.local === "ollama" || aiPins.docker === "ollama"
          ? "ollama"
          : localProvider;

      if (setupProvider !== "mock") {
        const picked = await askAiSetup({ provider: setupProvider });
        if (picked === null) return null;
        aiApply = withLocalAiImage(picked, askDockerAi ? dockerProvider : localProvider);
      } else {
        aiApply = { driver: "mock" };
      }

      aiPref = aiPrefWithModels(
        {
          enabled: true,
          provider: setupProvider,
          driver: aiPins.local,
        },
        aiApply,
      );
      break aiSetup;
    }
  }

  return toCreateDefaults({
    template,
    profile,
    drivers: { ...drivers, ai: aiPins },
    ai: aiPref,
  });
}

/**
 * Walk facet prompts for one env side.
 *
 * @param facets - Facet ids for the template
 * @param side - local or docker
 */
async function walkFacetsForSide(
  facets: readonly CustomizeFacetId[],
  side: CustomizeSide,
): Promise<SidePins | WizardBack | null> {
  const out: SidePins = {};
  let i = 0;
  while (i < facets.length) {
    const facet = facets[i]!;
    const result = await askOneFacet(facet, side, out);
    if (result === null) return null;
    if (result === WIZARD_BACK) {
      if (i === 0) return WIZARD_BACK;
      i--;
      continue;
    }
    i++;
  }
  return out;
}

async function askOneFacet(
  facet: CustomizeFacetId,
  side: CustomizeSide,
  state: SidePins,
): Promise<true | WizardBack | null> {
  const suffix = side === "local" ? "local" : "docker";
  switch (facet) {
    case "sql": {
      const v = await askSideChoice(
        `store.sql — ${suffix}`,
        SQL_CHOICES,
        side === "local" ? TEMPLATE_LOCAL.sql : TEMPLATE_DOCKER_PROD.sql,
      );
      if (v === null || v === WIZARD_BACK) return v;
      state.sql = v;
      return true;
    }
    case "kv": {
      const v = await askSideChoice(
        `store.kv — ${suffix}`,
        KV_CHOICES,
        side === "local" ? TEMPLATE_LOCAL.kv : TEMPLATE_DOCKER_PROD.kv,
      );
      if (v === null || v === WIZARD_BACK) return v;
      state.kv = v;
      return true;
    }
    case "files": {
      const v = await askSideChoice(
        `store.files — ${suffix}`,
        FILES_CHOICES,
        side === "local" ? TEMPLATE_LOCAL.files : TEMPLATE_DOCKER_PROD.files,
      );
      if (v === null || v === WIZARD_BACK) return v;
      state.files = v;
      return true;
    }
    case "index": {
      const v = await askSideChoice(
        `store.index — ${suffix}`,
        INDEX_CHOICES,
        side === "local" ? "none" : "meilisearch",
      );
      if (v === null || v === WIZARD_BACK) return v;
      state.index = v;
      return true;
    }
    case "signal": {
      const v = await askSideChoice(
        `signal — ${suffix}`,
        SIGNAL_CHOICES,
        side === "local" ? TEMPLATE_LOCAL.signal : TEMPLATE_DOCKER_PROD.signal,
      );
      if (v === null || v === WIZARD_BACK) return v;
      state.signal = v;
      return true;
    }
    case "clock": {
      const v = await askSideChoice(
        `clock — ${suffix}`,
        CLOCK_CHOICES,
        side === "local" ? TEMPLATE_LOCAL.clock : TEMPLATE_DOCKER_PROD.clock,
      );
      if (v === null || v === WIZARD_BACK) return v;
      state.clock = v;
      return true;
    }
    case "vault": {
      const v = await askSideChoice(
        `vault — ${suffix}`,
        VAULT_CHOICES,
        side === "local" ? TEMPLATE_LOCAL.vault : TEMPLATE_DOCKER_PROD.vault,
      );
      if (v === null || v === WIZARD_BACK) return v;
      state.vault = v;
      return true;
    }
    case "email": {
      const v = await askSideChoice(
        `channel.email — ${suffix}`,
        EMAIL_CHOICES,
        side === "local" ? TEMPLATE_LOCAL.email : TEMPLATE_DOCKER_PROD.email,
      );
      if (v === null || v === WIZARD_BACK) return v;
      state.email = v;
      return true;
    }
    default:
      return null;
  }
}

async function askSideChoice(
  label: string,
  choices: readonly DriverChoice[],
  recommended: string,
): Promise<string | WizardBack | null> {
  return selectWithBack(
    label,
    choices.map((c) => ({
      value: c.value,
      label: c.label,
      hint: c.value === recommended ? "recommended" : undefined,
    })),
    recommended,
    { allowBack: true },
  );
}
