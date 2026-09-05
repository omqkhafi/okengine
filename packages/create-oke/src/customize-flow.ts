/**
 * Customize wizard — walk Docker-first facets once, assemble `{ dev, test, prod }`.
 */

import { isCancel, password } from "@clack/prompts";
import { toCreateDefaults, type CreateDefaults, type EnvDriverPins } from "./create-defaults.ts";
import {
  CLOCK_CHOICES,
  EMAIL_CHOICES,
  FILES_CHOICES,
  INDEX_CHOICES,
  KV_CHOICES,
  SIGNAL_CHOICES,
  SQL_CHOICES,
  TEMPLATE_DEV,
  TEMPLATE_TEST,
  VAULT_CHOICES,
  customizeFacetsFor,
  pinsDockerReady,
  pinsEnv,
  type CustomizeFacetId,
  type DriverChoice,
} from "./drivers-catalog.ts";
import type { AiSetupApplyInput } from "./ai-setup/apply.ts";
import {
  aiDriverForMenuProvider,
  aiProviderSelectOptions,
  cloudApplyDefaults,
} from "./ai-setup/catalog.ts";
import { aiPrefWithModels } from "./ai-setup/from-pref.ts";
import { askAiSetup } from "./ai-setup/prompts.ts";
import type { TemplateId } from "./templates.ts";
import { WIZARD_BACK, selectWithBack, type WizardBack } from "./wizard-select.ts";

export type { WizardBack };
export { WIZARD_BACK };

/** Partial pins accumulated before merge. */
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
 * Assemble `{ dev, test, prod }` pins (prod mirrors dev).
 *
 * @param dev - Dev driver
 * @param test - Test pin
 * @param prod - Prod pin (defaults to `dev`)
 */
export function pinsFromSides(dev: string, test: string, prod: string = dev): EnvDriverPins {
  return pinsEnv(dev, test, prod);
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
 * Fill missing facets from template Docker-first defaults.
 *
 * @param picked - Values chosen during customize
 */
export function assembleDriverDefaults(picked: SidePins): CreateDefaults["drivers"] {
  const sql = pinsFromSides(picked.sql ?? TEMPLATE_DEV.sql, TEMPLATE_TEST.sql);
  const kv = pinsFromSides(picked.kv ?? TEMPLATE_DEV.kv, TEMPLATE_TEST.kv);
  const files = pinsFromSides(picked.files ?? TEMPLATE_DEV.files, TEMPLATE_TEST.files);
  const index = indexEnabled(picked.index)
    ? pinsFromSides(picked.index, "memory", picked.index)
    : null;

  return {
    store: { sql, kv, files, index },
    signal: pinsFromSides(picked.signal ?? TEMPLATE_DEV.signal, TEMPLATE_TEST.signal),
    clock: pinsFromSides(picked.clock ?? TEMPLATE_DEV.clock, TEMPLATE_TEST.clock),
    vault: pinsFromSides(picked.vault ?? TEMPLATE_DEV.vault, TEMPLATE_TEST.vault),
    channel: {
      email: pinsFromSides(picked.email ?? TEMPLATE_DEV.email, TEMPLATE_TEST.email),
    },
    ai: null,
  };
}

/**
 * Cloud defaults for "AI setup → Recommended" (no quiz).
 * OpenRouter registry provider + `openrouter/free` (zero Docker).
 */
export function recommendedAiApply(): AiSetupApplyInput {
  return cloudApplyDefaults("openrouter");
}

/**
 * Recommended path — OpenRouter defaults, then prompt for `OPENROUTER_API_KEY`.
 *
 * @returns Apply input with token, or null on cancel
 */
export async function askRecommendedAiApply(): Promise<AiSetupApplyInput | null> {
  const base = recommendedAiApply();
  const apiKeyEnv = base.apiKeyEnv ?? "OPENROUTER_API_KEY";
  const token = await password({
    message: `API token (${apiKeyEnv})`,
    validate: (v) => {
      if (!v?.trim()) return "API token is required";
      return undefined;
    },
  });
  if (isCancel(token)) return null;
  return { ...base, apiKey: String(token).trim() };
}

/**
 * Customize drivers for one template.
 *
 * @param template - Starter id (filters facets)
 */
export async function askCustomizeFlow(
  template: TemplateId,
): Promise<CreateDefaults | WizardBack | null> {
  const facets = customizeFacetsFor(template);
  const primaryPins = await walkFacets(facets);
  if (primaryPins === null) return null;
  if (primaryPins === WIZARD_BACK) return WIZARD_BACK;

  const drivers = assembleDriverDefaults(primaryPins);

  // AI — after env pass
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
          hint: "openrouter · openrouter/free",
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
      break;
    }
    if (aiSetup === "off") break;
    if (aiSetup === "recommended") {
      aiPins = pinsDockerReady("openai-compatible", "mock");
      const picked = await askRecommendedAiApply();
      if (picked === null) return null;
      aiApply = picked;
      aiPref = aiPrefWithModels(
        {
          enabled: true,
          provider: "openrouter",
          driver: "openai-compatible",
        },
        aiApply,
      );
      break;
    }

    const options = aiProviderSelectOptions({ includeMock: true });
    const providerValue = await selectWithBack("AI Provider", options, "openrouter", {
      allowBack: true,
    });
    if (providerValue === null) return null;
    if (providerValue === WIZARD_BACK) continue;

    const provider = providerValue;
    const driver = aiDriverForMenuProvider(provider);
    aiPins = pinsDockerReady(driver, "mock");

    if (provider !== "mock") {
      const picked = await askAiSetup({ provider });
      if (picked === null) return null;
      aiApply = picked;
    } else {
      aiApply = { driver: "mock" };
    }

    aiPref = aiPrefWithModels(
      {
        enabled: true,
        provider,
        driver: aiPins.dev,
      },
      aiApply,
    );
    break;
  }

  return toCreateDefaults({
    template,
    profile: "docker-ready",
    drivers: { ...drivers, ai: aiPins },
    ai: aiPref,
    // Locales / PgDog / proxy are asked once in the main wizard (not per customize pass).
    locales: [],
    pgdog: false,
    proxy: "none",
  });
}

/**
 * Walk facet prompts for the Docker-first runtime.
 *
 * @param facets - Facet ids for the template
 */
async function walkFacets(
  facets: readonly CustomizeFacetId[],
): Promise<SidePins | WizardBack | null> {
  const out: SidePins = {};
  let i = 0;
  while (i < facets.length) {
    const facet = facets[i]!;
    const result = await askOneFacet(facet, out);
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
  state: SidePins,
): Promise<true | WizardBack | null> {
  switch (facet) {
    case "sql": {
      const v = await askSideChoice("store.sql — dev/prod", SQL_CHOICES, TEMPLATE_DEV.sql);
      if (v === null || v === WIZARD_BACK) return v;
      state.sql = v;
      return true;
    }
    case "kv": {
      const v = await askSideChoice("store.kv — dev/prod", KV_CHOICES, TEMPLATE_DEV.kv);
      if (v === null || v === WIZARD_BACK) return v;
      state.kv = v;
      return true;
    }
    case "files": {
      const v = await askSideChoice("store.files — dev/prod", FILES_CHOICES, TEMPLATE_DEV.files);
      if (v === null || v === WIZARD_BACK) return v;
      state.files = v;
      return true;
    }
    case "index": {
      const v = await askSideChoice("store.index — dev/prod", INDEX_CHOICES, "meilisearch");
      if (v === null || v === WIZARD_BACK) return v;
      state.index = v;
      return true;
    }
    case "signal": {
      const v = await askSideChoice("signal — dev/prod", SIGNAL_CHOICES, TEMPLATE_DEV.signal);
      if (v === null || v === WIZARD_BACK) return v;
      state.signal = v;
      return true;
    }
    case "clock": {
      const v = await askSideChoice("clock — dev/prod", CLOCK_CHOICES, TEMPLATE_DEV.clock);
      if (v === null || v === WIZARD_BACK) return v;
      state.clock = v;
      return true;
    }
    case "vault": {
      const v = await askSideChoice("vault — dev/prod", VAULT_CHOICES, TEMPLATE_DEV.vault);
      if (v === null || v === WIZARD_BACK) return v;
      state.vault = v;
      return true;
    }
    case "email": {
      const v = await askSideChoice("channel.email — dev/prod", EMAIL_CHOICES, TEMPLATE_DEV.email);
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
