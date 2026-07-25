/**
 * Console per-panel backends construct lazily on first access.
 */

import { describe, expect, test } from "bun:test";
import { createConsoleState } from "./state.ts";

describe("console — lazy panel construction", () => {
  test("createConsoleState constructs no panel backends", () => {
    const state = createConsoleState({ silentClaim: true, secret: "x" });
    expect([...state.constructedPanels]).toEqual([]);
  });

  test("only the visited panel is constructed", async () => {
    const state = createConsoleState({ silentClaim: true, secret: "x" });
    expect([...state.constructedPanels]).toEqual([]);

    await state.listVault();
    expect([...state.constructedPanels]).toEqual(["vault"]);

    await state.listStores();
    expect([...state.constructedPanels].sort()).toEqual(["store", "vault"]);

    await state.listVault();
    expect([...state.constructedPanels].sort()).toEqual(["store", "vault"]);
  });
});
