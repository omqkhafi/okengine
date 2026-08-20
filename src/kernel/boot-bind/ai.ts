/**
 * Lazy AI binder — loaded only when AI is declared.
 *
 * Resolves `drivers.ai` the same way store.index resolves its driver map:
 * shared `aiDriverFor` switch, fail-loud on unknown / reserved-unimplemented
 * ids, never a silent mock fallback when another driver is configured.
 */

import { resolveDriverId, type ConfigEnv } from "../../config/index.ts";
import { anthropicAiDriver } from "../../drivers/ai-anthropic.ts";
import { mockAiDriver } from "../../drivers/ai-mock.ts";
import {
  normalizeOllamaBaseUrl,
  ollamaAiDriver,
  OLLAMA_DEFAULT_BASE_URL,
} from "../../drivers/ai-ollama.ts";
import { openaiCompatibleAiDriver } from "../../drivers/ai-openai-compatible.ts";
import type { AiDriver, AiOpenOptions } from "../../drivers/ai-types.ts";
import { createAiRuntime, type AiRuntime } from "../../elements/ai.ts";
import type { GateRuntime } from "../../elements/gate.ts";
import type { VaultRuntime } from "../../elements/vault.ts";
import type { BootOptions } from "../boot.ts";

/**
 * Construct an AI runtime from config / injection.
 *
 * @param options - Boot options
 * @param gate - Gate runtime for agent tool checks
 * @param now - Clock
 * @param env - Active environment
 * @param docker - Prefer compose AI URL when active
 * @param vault - Optional vault for MCP bearer secrets
 */
export function bindAi(
  options: BootOptions,
  gate: GateRuntime | undefined,
  now: () => number,
  env: ConfigEnv = "test",
  docker = false,
  vault?: VaultRuntime,
): AiRuntime {
  const id = resolveAiDriverId(options, env, docker);
  const driver =
    options.ai?.defaultDriver ?? withOpenDefaults(aiDriverFor(id), openDefaultsFor(id, docker));
  return createAiRuntime({
    ...(options.ai ?? {}),
    ...(vault ? { resolveSecret: (name: string) => vault.read(name) } : undefined),
    defaultDriver: driver,
    drivers: {
      mock: lazyDriver("mock", docker),
      anthropic: lazyDriver("anthropic", docker),
      "openai-compatible": lazyDriver("openai-compatible", docker),
      ollama: lazyDriver("ollama", docker),
    },
    gates: options.ai?.gates ?? gate,
    now,
  });
}

/**
 * Resolve the configured AI driver for one environment.
 *
 * Dev / test default is `mock`. There is **no** production default — prod must
 * declare. Docker may override via `OKE_AI_DRIVER`. A live `OKE_AI_URL` never
 * resolves to mock (Call API attach after `oke keel reset`).
 *
 * @param options - Boot options
 * @param env - Active environment
 * @param docker - Docker mode
 */
export function resolveAiDriverId(options: BootOptions, env: ConfigEnv, docker = false): string {
  const fromEnv = process.env.OKE_AI_DRIVER?.trim();
  const liveUrl = Boolean(process.env.OKE_AI_URL?.trim() || process.env.OPENAI_BASE_URL?.trim());
  if (docker && fromEnv) return fromEnv;
  // Compose / `oke dev` writes OKE_AI_URL. Never silently mock that endpoint
  // just because boot env resolved to `test` (Call API attach after reset).
  if (liveUrl && fromEnv && fromEnv !== "mock") return fromEnv;
  const resolved = resolveDriverId(options.config?.drivers?.ai, env);
  if (liveUrl && (resolved === undefined || resolved === "mock")) {
    return fromEnv === "ollama" ? "ollama" : "openai-compatible";
  }
  if (resolved) return resolved;
  return "mock";
}

/**
 * Single id → AI driver switch — shared by boot (and future Console) so
 * resolution can never drift into two maintained copies.
 *
 * @param id - Protocol driver id
 */
export function aiDriverFor(id: string): AiDriver {
  switch (id) {
    case "mock":
      return mockAiDriver;
    case "anthropic":
      return anthropicAiDriver;
    case "openai-compatible":
      return openaiCompatibleAiDriver;
    case "ollama":
      return ollamaAiDriver;
    case "bedrock":
    case "vertex":
      throw new Error(`oke boot: AI driver "${id}" is reserved but not implemented yet`);
    default:
      throw new Error(`oke boot: unknown AI driver "${id}"`);
  }
}

/**
 * Open defaults for a resolved driver id (URL / key from env).
 *
 * @param id - Driver id
 * @param docker - Docker mode
 */
export function openDefaultsFor(id: string, docker = false): AiOpenOptions {
  if (id === "ollama") {
    return {
      baseUrl: aiUrlFor(docker),
      ...(process.env.OKE_AI_MODEL?.trim() ? { model: process.env.OKE_AI_MODEL.trim() } : {}),
    };
  }
  if (id === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    return {
      ...(apiKey ? { apiKey } : {}),
      ...(process.env.ANTHROPIC_MODEL?.trim() ? { model: process.env.ANTHROPIC_MODEL.trim() } : {}),
    };
  }
  if (id === "openai-compatible") {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    const baseUrl = process.env.OPENAI_BASE_URL?.trim() || process.env.OKE_AI_URL?.trim();
    if (docker && !baseUrl) {
      throw new Error(
        "oke boot: openai-compatible driver needs OKE_AI_URL (did `oke dev` write .env.local?)",
      );
    }
    return {
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(process.env.OKE_AI_MODEL?.trim() ? { model: process.env.OKE_AI_MODEL.trim() } : {}),
    };
  }
  return {};
}

/**
 * Ollama base URL — docker fails loud when compose did not write one.
 *
 * @param docker - Docker mode
 */
export function aiUrlFor(docker = false): string {
  const raw = process.env.OKE_AI_URL?.trim() || process.env.OLLAMA_HOST?.trim();
  if (raw) return normalizeOllamaBaseUrl(raw);
  if (docker) {
    throw new Error(
      "oke boot: ollama driver needs OKE_AI_URL (did `oke dev -d` write .env.local?)",
    );
  }
  return OLLAMA_DEFAULT_BASE_URL;
}

/**
 * Merge fixed open defaults under per-call options.
 *
 * @param driver - Base driver
 * @param defaults - Env-derived open options
 */
/**
 * Open a protocol driver with env defaults only when a model actually uses it.
 *
 * @param id - Driver id
 * @param docker - Docker mode
 */
function lazyDriver(id: string, docker: boolean): AiDriver {
  const base = aiDriverFor(id);
  return {
    id: base.id,
    open: (opts = {}) => base.open({ ...openDefaultsFor(id, docker), ...opts }),
  };
}

function withOpenDefaults(driver: AiDriver, defaults: AiOpenOptions): AiDriver {
  if (Object.keys(defaults).length === 0) return driver;
  return {
    id: driver.id,
    open: (opts = {}) => driver.open({ ...defaults, ...opts }),
  };
}
