/**
 * Operator-declared vault contracts — Console Add, not Manifest source.
 *
 * Lives under `.oke/` (gitignored). Does not read process.env names.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Relative path from the project root. */
export const VAULT_OVERLAY_REL = ".oke/vault-contracts.json";

/** One Console-created contract (metadata only — never the value). */
export interface VaultOverlayContract {
  readonly name: string;
  readonly kind: "secret" | "config";
  readonly description?: string;
  readonly rotate?: string;
}

const NAME_RE = /^[A-Z][A-Z0-9_]{0,127}$/;

/**
 * Whether `name` is a legal vault contract key.
 *
 * @param name - Candidate
 */
export function isVaultContractName(name: string): boolean {
  return NAME_RE.test(name);
}

/**
 * Absolute overlay path for a project root.
 *
 * @param cwd - Project root
 */
export function vaultOverlayPath(cwd: string): string {
  return join(cwd, VAULT_OVERLAY_REL);
}

/**
 * Load Console-created contracts. Missing / invalid file → empty.
 *
 * @param cwd - Project root
 */
export async function loadVaultOverlay(cwd: string): Promise<readonly VaultOverlayContract[]> {
  try {
    const raw = await readFile(vaultOverlayPath(cwd), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("contracts" in parsed)) return [];
    const contracts = (parsed as { contracts: unknown }).contracts;
    if (!Array.isArray(contracts)) return [];
    const out: VaultOverlayContract[] = [];
    for (const row of contracts) {
      const c = asContract(row);
      if (c) out.push(c);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Insert or replace one overlay contract. Values are never stored here.
 *
 * @param cwd - Project root
 * @param contract - Metadata
 */
export async function upsertVaultOverlay(
  cwd: string,
  contract: VaultOverlayContract,
): Promise<void> {
  if (!isVaultContractName(contract.name)) {
    throw new Error(`vault: invalid contract name "${contract.name}"`);
  }
  const existing = [...(await loadVaultOverlay(cwd))];
  const next = existing.filter((c) => c.name !== contract.name);
  next.push(contract);
  next.sort((a, b) => a.name.localeCompare(b.name));
  const path = vaultOverlayPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ contracts: next }, null, 2)}\n`, "utf8");
}

function asContract(row: unknown): VaultOverlayContract | null {
  if (!row || typeof row !== "object") return null;
  const rec = row as Record<string, unknown>;
  if (typeof rec.name !== "string" || !isVaultContractName(rec.name)) return null;
  if (rec.kind !== "secret" && rec.kind !== "config") return null;
  return {
    name: rec.name,
    kind: rec.kind,
    ...(typeof rec.description === "string" && rec.description.length > 0
      ? { description: rec.description }
      : {}),
    ...(typeof rec.rotate === "string" && rec.rotate.length > 0 ? { rotate: rec.rotate } : {}),
  };
}
