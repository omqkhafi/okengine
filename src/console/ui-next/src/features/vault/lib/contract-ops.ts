/**
 * Operator snippets for one vault contract — never include secret values.
 */

import { vaultDriverHint, vaultDriverShortLabel } from "./backend.ts";
import type { VaultBackend, VaultResolutionSource } from "./types.ts";

/** One copyable fill recipe for a resolution layer. */
export interface VaultLayerFill {
  readonly source: VaultResolutionSource;
  readonly label: string;
  readonly command: string;
  readonly hint: string;
}

/**
 * Flow read snippet for a contract name.
 *
 * @param name - Contract name
 */
export function vaultFxSnippet(name: string): string {
  return `await fx.vault.get(${name})`;
}

/**
 * CLI set — value is typed at the prompt, never in this string.
 *
 * @param name - Contract name
 */
export function vaultSetCli(name: string): string {
  return `oke vault set ${name}`;
}

/**
 * CLI rotate — value is typed at the prompt.
 *
 * @param name - Contract name
 */
export function vaultRotateCli(name: string): string {
  return `oke vault rotate ${name}`;
}

/**
 * Dotenv assignment with an empty value (operator fills it).
 *
 * @param name - Contract name
 */
export function vaultDotenvLine(name: string): string {
  return `${name}=`;
}

/**
 * How to populate one resolution layer — commands only, no values.
 *
 * @param source - Layer
 * @param name - Contract name
 * @param backend - Active vault backend (names the driver layer)
 */
export function vaultLayerFill(
  source: VaultResolutionSource,
  name: string,
  backend?: VaultBackend | null,
): VaultLayerFill {
  switch (source) {
    case "process.env":
      return {
        source,
        label: "env",
        command: `export ${name}=`,
        hint: "Process environment for this Console process",
      };
    case ".env.local":
      return {
        source,
        label: "local",
        command: vaultDotenvLine(name),
        hint: "Write to .env.local (gitignored)",
      };
    case "driver":
      return {
        source,
        label: vaultDriverShortLabel(backend),
        command: vaultSetCli(name),
        hint: vaultDriverHint(backend),
      };
    case "dev-fallback":
      return {
        source,
        label: "fallback",
        command: `dev: "…"`,
        hint: "Local-only option on the contract — never used in prod",
      };
  }
}
