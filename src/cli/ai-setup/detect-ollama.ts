/**
 * Detect local Ollama — CLI (`ollama list` / `ps`) and HTTP `/api/tags`.
 */

import { OLLAMA_DEFAULT_BASE_URL, normalizeOllamaBaseUrl } from "../../drivers/ai-ollama.ts";
import { ALL_CURATED, type CatalogModel } from "./catalog.ts";

/** Result of probing the local Ollama install. */
export type OllamaDetectResult = {
  readonly available: boolean;
  readonly baseUrl: string;
  readonly installed: readonly string[];
  readonly running: readonly string[];
  readonly curatedInstalled: readonly CatalogModel[];
  readonly curatedMissing: readonly CatalogModel[];
};

/**
 * Parse `ollama list` tabular output into model names.
 *
 * @param stdout - CLI stdout
 */
export function parseOllamaList(stdout: string): string[] {
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    if (/^NAME\b/i.test(line)) continue;
    const name = line.split(/\s+/)[0];
    if (name) out.push(name);
  }
  return out;
}

/**
 * Parse `ollama ps` tabular output into running model names.
 *
 * @param stdout - CLI stdout
 */
export function parseOllamaPs(stdout: string): string[] {
  return parseOllamaList(stdout);
}

/**
 * Normalize installed tag for comparison (`qwen3.5:9b` vs `qwen3.5:9b-mlx`).
 *
 * @param id - Catalog or installed id
 * @param installed - Installed names
 */
export function isInstalled(id: string, installed: readonly string[]): boolean {
  const base = id.split(":")[0] ?? id;
  return installed.some((name) => {
    if (name === id) return true;
    if (name.startsWith(`${id}-`)) return true;
    if (name.startsWith(`${base}:`) && id.startsWith(`${base}:`)) {
      // treat mlx / quant suffixes as matching the same family:tag when prefix matches
      const instTag = name.slice(base.length + 1);
      const wantTag = id.slice(base.length + 1);
      return (
        instTag === wantTag || instTag.startsWith(`${wantTag}-`) || wantTag.startsWith(instTag)
      );
    }
    return false;
  });
}

/**
 * Detect Ollama via CLI then HTTP fallback.
 *
 * @param options - Base URL / spawn / fetch seams
 */
export async function detectOllama(
  options: {
    readonly baseUrl?: string;
    readonly fetch?: typeof globalThis.fetch;
    readonly run?: (cmd: readonly string[]) => Promise<{ code: number; stdout: string }>;
  } = {},
): Promise<OllamaDetectResult> {
  const baseUrl = normalizeOllamaBaseUrl(options.baseUrl ?? OLLAMA_DEFAULT_BASE_URL);
  const run =
    options.run ??
    (async (cmd) => {
      const proc = Bun.spawn([...cmd], { stdout: "pipe", stderr: "pipe" });
      const stdout = await new Response(proc.stdout).text();
      const code = await proc.exited;
      return { code, stdout };
    });

  let installed: string[] = [];
  let running: string[] = [];
  let available = false;

  try {
    const list = await run(["ollama", "list"]);
    if (list.code === 0) {
      available = true;
      installed = parseOllamaList(list.stdout);
    }
    const ps = await run(["ollama", "ps"]);
    if (ps.code === 0) {
      running = parseOllamaPs(ps.stdout);
    }
  } catch {
    // CLI missing — try HTTP
  }

  if (!available) {
    const fetchFn = options.fetch ?? globalThis.fetch;
    try {
      const res = await fetchFn(`${baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(2_000),
      });
      if (res.ok) {
        available = true;
        const json = (await res.json()) as { models?: readonly { name?: string }[] };
        installed = (json.models ?? [])
          .map((m) => m.name)
          .filter((n): n is string => typeof n === "string");
      }
    } catch {
      // unavailable
    }
  }

  const curatedInstalled = ALL_CURATED.filter((m) => isInstalled(m.id, installed));
  const curatedMissing = ALL_CURATED.filter((m) => !isInstalled(m.id, installed));

  return {
    available,
    baseUrl,
    installed,
    running,
    curatedInstalled,
    curatedMissing,
  };
}

/**
 * Best-effort total system RAM in GB.
 */
export function detectTotalRamGb(): number | null {
  try {
    if (process.platform === "darwin") {
      const proc = Bun.spawnSync(["sysctl", "-n", "hw.memsize"], { stdout: "pipe" });
      if (proc.exitCode === 0) {
        const bytes = Number(proc.stdout.toString().trim());
        if (Number.isFinite(bytes) && bytes > 0) return Math.round(bytes / 1024 ** 3);
      }
    }
    if (process.platform === "linux") {
      const proc = Bun.spawnSync(["awk", "/MemTotal/ {print $2}", "/proc/meminfo"], {
        stdout: "pipe",
      });
      if (proc.exitCode === 0) {
        const kb = Number(proc.stdout.toString().trim());
        if (Number.isFinite(kb) && kb > 0) return Math.round(kb / 1024 ** 2);
      }
    }
  } catch {
    // ignore
  }
  return null;
}
