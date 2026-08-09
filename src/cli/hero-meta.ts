/**
 * Resolve `oke dev` hero facts — eight elements, profile, env, system.
 */

import { release } from "node:os";
import {
  resolveDriverId,
  type ConfigEnv,
  type DriversConfig,
  type OkeConfig,
} from "../config/index.ts";
import type { DevStatus } from "../term.ts";

/** How the process is running (dev Compose → production). */
export type DevRuntimeProfile = "dev" | "test" | "production";

/** Data plane: still on a laptop vs production deploy. */
export type DevRuntimeEnv = "dev" | "production";

/** One of the eight elements with its active driver summary. */
export type HeroElementRow = {
  readonly element: string;
  /** Driver summary, or `—` when unbound. */
  readonly detail: string;
  /** Status dot — ready / pending / error / idle. */
  readonly status?: DevStatus;
};

/** Serializable hero payload (TTY + soft-reload env). */
export type DevHeroSnapshot = {
  readonly profile: DevRuntimeProfile;
  readonly runtimeEnv: DevRuntimeEnv;
  readonly system: string;
  readonly elements: readonly HeroElementRow[];
  readonly version?: string;
};

const EIGHT_ELEMENTS = [
  "flow",
  "signal",
  "store",
  "clock",
  "gate",
  "vault",
  "channel",
  "ai",
] as const;

/**
 * Host / runtime line for the hero (`darwin 25.4.0 · bun 1.3.14`).
 */
export function formatHeroSystemLine(
  bunVersion: string = Bun.version,
  platform: string = process.platform,
  osRelease: string = release(),
): string {
  return `${platform} ${osRelease} · bun ${bunVersion}`;
}

/**
 * Profile for an `oke dev` session.
 *
 * @param options - Docker / NODE_ENV hints
 */
export function resolveDevProfile(options: {
  readonly docker: boolean;
  /** Explicit role — do not infer from ambient `NODE_ENV` (tests set `test`). */
  readonly nodeEnv?: string;
}): DevRuntimeProfile {
  if (options.nodeEnv === "test") return "test";
  if (options.nodeEnv === "production") return "production";
  void options.docker;
  return "dev";
}

/**
 * Data-plane environment (dev machine vs production deploy).
 *
 * @param profile - Runtime profile
 */
export function resolveDevRuntimeEnv(profile: DevRuntimeProfile): DevRuntimeEnv {
  return profile === "production" ? "production" : "dev";
}

/**
 * Active driver id for an env map, preferring {@link prefer} when set.
 *
 * @param map - Env driver map
 * @param env - Config env key
 * @param prefer - Override (docker sql/kv)
 */
function driverOr(
  map: Parameters<typeof resolveDriverId>[0],
  env: ConfigEnv,
  prefer?: string,
): string | undefined {
  if (prefer !== undefined && prefer.length > 0) return prefer;
  return resolveDriverId(map, env);
}

/**
 * Summarize channel mediums for the active config env.
 *
 * @param channel - Channel driver maps
 * @param env - Config env
 */
function channelDetail(channel: DriversConfig["channel"], env: ConfigEnv): string {
  if (!channel) return "—";
  const parts: string[] = [];
  for (const medium of ["email", "sms", "whatsapp", "push"] as const) {
    const id = resolveDriverId(channel[medium], env);
    if (id) parts.push(`${medium} ${id}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/**
 * Summarize store facets for the active (or docker-overridden) drivers.
 *
 * @param store - Store driver maps
 * @param env - Config env for non-overridden facets
 * @param overrides - Docker sql/kv ids
 */
function storeDetail(
  store: DriversConfig["store"],
  env: ConfigEnv,
  overrides: { readonly sql?: string; readonly kv?: string },
): string {
  if (!store && !overrides.sql && !overrides.kv) return "—";
  const parts: string[] = [];
  const sql = driverOr(store?.sql, env, overrides.sql);
  const kv = driverOr(store?.kv, env, overrides.kv);
  const files = resolveDriverId(store?.files, env);
  const index = resolveDriverId(store?.index, env);
  if (sql) parts.push(`sql ${sql}`);
  if (kv) parts.push(`kv ${kv}`);
  if (files) parts.push(`files ${files}`);
  if (index) parts.push(`index ${index}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/**
 * Resolve eight-element rows from `oke.config` + docker overrides.
 *
 * @param config - Loaded config (or null)
 * @param options - Docker driver overrides; config env for maps
 */
export function resolveHeroElements(
  config: OkeConfig | null | undefined,
  options: {
    /** Use docker store ids from stack (`oke dev -d`). */
    readonly docker: boolean;
    readonly sqlDriver?: string;
    readonly kvDriver?: string;
    /** Configured model id (`OKE_AI_MODEL`) when known. */
    readonly aiModel?: string;
    /** AI readiness when known (model loading / ready). */
    readonly aiStatus?: DevStatus;
    /** Which driver map column to read (default `test` unless `docker`). */
    readonly configEnv?: ConfigEnv;
  },
): readonly HeroElementRow[] {
  const drivers = config?.drivers;
  // `-d` reads the `docker` profile for every element (not a store-only override).
  const configEnv: ConfigEnv = options.configEnv ?? (options.docker ? "dev" : "test");

  // Gate rates share `drivers.store.kv` (no separate drivers.gate).
  const gateKv =
    options.kvDriver ??
    resolveDriverId(drivers?.store?.kv, configEnv) ??
    (options.docker ? "redis" : "memory");

  const aiDriver = resolveDriverId(drivers?.ai, configEnv);
  const aiModel = options.aiModel?.trim();
  const aiDetail = aiDriver && aiModel ? `${aiDriver} · ${aiModel}` : (aiDriver ?? "—");

  const byName: Record<string, string> = {
    // Status ● is rendered separately — flow has no driver id.
    flow: "",
    signal: resolveDriverId(drivers?.signal, configEnv) ?? "—",
    store: storeDetail(drivers?.store, configEnv, {
      sql: options.sqlDriver,
      kv: options.kvDriver,
    }),
    clock: resolveDriverId(drivers?.clock, configEnv) ?? "—",
    gate: gateKv,
    vault: resolveDriverId(drivers?.vault, configEnv) ?? "—",
    channel: channelDetail(drivers?.channel, configEnv),
    ai: aiDetail,
  };

  return EIGHT_ELEMENTS.map((element) => {
    const detail = byName[element] ?? "—";
    const idle = detail === "—" || detail === "";
    let status: DevStatus = idle && element !== "flow" ? "idle" : "ready";
    if (element === "flow") status = "ready";
    if (element === "ai" && options.aiStatus && !idle) status = options.aiStatus;
    return { element, detail, status };
  });
}

/**
 * Build the full hero snapshot for banner / soft reload.
 *
 * @param options - Config, docker, versions
 */
export function buildDevHeroSnapshot(options: {
  readonly config?: OkeConfig | null;
  readonly docker: boolean;
  readonly sqlDriver?: string;
  readonly kvDriver?: string;
  /** Configured model id (`OKE_AI_MODEL`) when known. */
  readonly aiModel?: string;
  /** AI readiness when known (model loading / ready). */
  readonly aiStatus?: DevStatus;
  readonly version?: string;
  readonly nodeEnv?: string;
}): DevHeroSnapshot {
  const profile = resolveDevProfile({
    docker: options.docker,
    nodeEnv: options.nodeEnv,
  });
  return {
    profile,
    runtimeEnv: resolveDevRuntimeEnv(profile),
    system: formatHeroSystemLine(),
    elements: resolveHeroElements(options.config, {
      docker: options.docker,
      sqlDriver: options.sqlDriver,
      kvDriver: options.kvDriver,
      aiModel: options.aiModel,
      aiStatus: options.aiStatus,
    }),
    ...(options.version !== undefined ? { version: options.version } : {}),
  };
}

/**
 * Encode snapshot for the app child soft-reload env.
 *
 * @param snapshot - Hero facts
 */
export function encodeHeroSnapshot(snapshot: DevHeroSnapshot): string {
  return JSON.stringify(snapshot);
}

/**
 * Decode soft-reload hero env (invalid → null).
 *
 * @param raw - JSON from `OKE_DEV_HERO_META`
 */
export function decodeHeroSnapshot(raw: string | undefined): DevHeroSnapshot | null {
  if (raw === undefined || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("profile" in parsed) ||
      !("runtimeEnv" in parsed) ||
      !("system" in parsed) ||
      !("elements" in parsed) ||
      !Array.isArray((parsed as DevHeroSnapshot).elements)
    ) {
      return null;
    }
    return parsed as DevHeroSnapshot;
  } catch {
    return null;
  }
}
