/**
 * Interactive fill for Vault boot gaps during `oke dev`.
 *
 * Probes the same gap set app boot would throw (`allowDevFallbacks` on for
 * `dev`), then prompts one-by-one and persists into `.env.local`.
 */

import { resolve } from "node:path";
import { resolveDriverId } from "../config/index.ts";
import { VAULT_DEFAULTS } from "../config/driver-defaults.ts";
import { resolveAppEntryForPluginTables } from "../elements/store/load-plugin-tables.ts";
import {
  buildVaultBootChain,
  normalizeVaultDriverId,
} from "../elements/vault/boot-chain.ts";
import {
  createVaultRuntime,
  VaultBootError,
  type VaultGap,
} from "../elements/vault/runtime.ts";
import { requiredEnvRegistry, secretRegistry } from "../kernel/element-registries.ts";
import { formatCliChrome } from "../term.ts";
import { loadOkeConfig } from "./load-config.ts";
import { openEnvStore } from "./vault-cmd.ts";
import { promptHidden } from "./vault-secure-input.ts";

/** Options for {@link maybeAskVaultGaps}. */
export interface AskVaultGapsOptions {
  readonly cwd: string;
  /** App entry override (relative or absolute). */
  readonly entry?: string;
  readonly write?: (text: string) => void;
  readonly stdinIsTTY?: boolean;
  /** Skip prompt (tests / non-interactive). */
  readonly skip?: boolean;
  /**
   * Injectable gap probe (tests). Default: import entry + vault boot.
   */
  readonly gapsFn?: () => Promise<readonly VaultGap[]>;
  /**
   * Injectable secret reader (tests). Default: {@link promptHidden}.
   */
  readonly readSecret?: (prompt: string) => Promise<string>;
  /**
   * Env file relative to cwd (default `.env.local`).
   */
  readonly envFile?: string;
}

/**
 * Probe Vault contracts declared by the app entry and return boot gaps.
 *
 * @param cwd - Project root
 * @param entry - Optional entry override
 */
export async function probeVaultGaps(
  cwd: string,
  entry?: string,
): Promise<readonly VaultGap[]> {
  const prevSecrets = secretRegistry.slice();
  const prevRequired = requiredEnvRegistry.slice();
  secretRegistry.length = 0;
  requiredEnvRegistry.length = 0;
  try {
    const entryAbs = await resolveAppEntryForPluginTables(cwd, entry);
    if (!entryAbs) return [];
    await import(entryAbs);
    const secrets = secretRegistry.slice();
    const requiredEnv = requiredEnvRegistry.slice();
    if (secrets.length === 0 && requiredEnv.length === 0) return [];

    const loaded = await loadOkeConfig(cwd).catch(() => null);
    const configEnv = "dev" as const;
    const driverId = normalizeVaultDriverId(
      resolveDriverId(loaded?.config?.drivers?.vault, configEnv, VAULT_DEFAULTS) ?? "env",
    );
    const chain = buildVaultBootChain({
      driverId,
      env: configEnv,
      cwd,
      seed: {},
    });
    const vault = createVaultRuntime({
      secrets,
      requiredEnv,
      chain,
      allowDevFallbacks: true,
    });
    try {
      await vault.boot();
      return [];
    } catch (err) {
      if (err instanceof VaultBootError) return err.gaps;
      throw err;
    }
  } finally {
    secretRegistry.length = 0;
    secretRegistry.push(...prevSecrets);
    requiredEnvRegistry.length = 0;
    requiredEnvRegistry.push(...prevRequired);
  }
}

/**
 * After compose hydrate (and usually schema push), fill Vault boot gaps
 * one-by-one into `.env.local`. Skips when non-TTY or no gaps.
 *
 * @param options - Project / injectables
 * @returns `0` when ready to continue, `1` when aborted (still missing)
 */
export async function maybeAskVaultGaps(options: AskVaultGapsOptions): Promise<number> {
  if (options.skip) return 0;
  const tty = options.stdinIsTTY ?? Boolean(process.stdin.isTTY);
  if (!tty) return 0;

  const cwd = options.cwd;
  const write = options.write ?? ((t) => process.stdout.write(t));
  const chromeWrite = (t: string) => write(formatCliChrome(t));

  const gaps = options.gapsFn ? await options.gapsFn() : await probeVaultGaps(cwd, options.entry);
  if (gaps.length === 0) return 0;

  chromeWrite(
    gaps.length === 1
      ? "oke vault: 1 missing secret — enter a value (stored in .env.local)\n"
      : `oke vault: ${gaps.length} missing secrets — enter each value (stored in .env.local)\n`,
  );

  const envPath = resolve(cwd, options.envFile ?? ".env.local");
  const store = await openEnvStore(envPath);
  const read =
    options.readSecret ?? ((prompt: string) => promptHidden(prompt, { write: chromeWrite }));

  const remaining: VaultGap[] = [];
  for (const gap of gaps) {
    const label = gap.description ? `${gap.name} (${gap.description})` : gap.name;
    const value = (await read(`Enter value for ${label}: `)).trim();
    if (value.length === 0) {
      remaining.push(gap);
      chromeWrite(`oke vault: skipped ${gap.name} (empty)\n`);
      continue;
    }
    store.set(gap.name, value);
    process.env[gap.name] = value;
    chromeWrite(`oke vault: set ${gap.name}\n`);
  }
  await store.save?.();

  if (remaining.length > 0) {
    const err = new VaultBootError(remaining);
    chromeWrite(`${err.message}\n`);
    chromeWrite("oke vault: set the missing names, then re-run `oke dev`\n");
    return 1;
  }
  return 0;
}
