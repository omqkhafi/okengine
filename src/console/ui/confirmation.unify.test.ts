/**
 * Typed-confirmation unification — every panel must call the shared
 * `validateTypedConfirm` from `flows/confirmation.ts`, not a local reimplementation.
 */

import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { validateTypedConfirm as shared } from "./flows/confirmation.ts";
import { validateTypedConfirm as fromAccess } from "./access/confirmation.ts";
import { validateTypedConfirm as fromChannels } from "./channels/confirmation.ts";
import { validateTypedConfirm as fromClock } from "./clock/confirmation.ts";
import { validateTypedConfirm as fromSignals } from "./signals/confirmation.ts";
import { validateTypedConfirm as fromStore } from "./store/confirmation.ts";
import { validateTypedConfirm as fromVault } from "./vault/confirmation.ts";

const UI_ROOT = import.meta.dir;

/**
 * Collect `*.ts` / `*.tsx` under a directory (skip dist / node_modules).
 *
 * @param dir - Root
 */
async function collectSources(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") continue;
      out.push(...(await collectSources(path)));
      continue;
    }
    if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe("validateTypedConfirm unification", () => {
  test("every panel confirmation module re-exports the shared implementation", () => {
    expect(fromAccess).toBe(shared);
    expect(fromChannels).toBe(shared);
    expect(fromClock).toBe(shared);
    expect(fromSignals).toBe(shared);
    expect(fromStore).toBe(shared);
    expect(fromVault).toBe(shared);
  });

  test("no panel reimplements typed-confirm validation locally", async () => {
    const files = await collectSources(UI_ROOT);
    const localImpl: string[] = [];
    for (const file of files) {
      if (file.endsWith("/flows/confirmation.ts")) continue;
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      const text = await Bun.file(file).text();
      // A local function body (not a re-export) would declare the name with `(`.
      if (/function\s+validateTypedConfirm\s*\(/.test(text)) {
        localImpl.push(file);
      }
      if (
        /const\s+validateTypedConfirm\s*=/.test(text) &&
        !/export\s*\{[^}]*validateTypedConfirm/.test(text)
      ) {
        // Allow `import { validateTypedConfirm }` — flag only local const assignment.
        if (!/import\s*\{[^}]*validateTypedConfirm/.test(text)) {
          localImpl.push(file);
        }
      }
    }
    expect(localImpl).toEqual([]);
  });

  test("call sites cover Signals · Store · Clock · Access · Channels · Vault · Flows", async () => {
    const expected = [
      "shell/panels/signals/SignalsPanel.tsx",
      "shell/panels/store/StorePanel.tsx",
      "shell/panels/clock/ClockPanel.tsx",
      "shell/panels/access/AccessPanel.tsx",
      "shell/panels/channels/ChannelsPanel.tsx",
      "shell/panels/vault/VaultPanel.tsx",
      "shell/panels/flows/FlowDrawer.tsx",
    ];
    const missing: string[] = [];
    for (const rel of expected) {
      const text = await Bun.file(join(UI_ROOT, rel)).text();
      if (!text.includes("validateTypedConfirm(")) {
        missing.push(rel);
      }
    }
    expect(missing).toEqual([]);
  });
});
