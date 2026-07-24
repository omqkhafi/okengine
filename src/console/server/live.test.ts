/**
 * Manifest live feed — subscribers receive snapshot + diff.
 */

import { describe, expect, test } from "bun:test";
import type { Manifest } from "../../manifest/types.ts";
import { feedManifest, subscribeLive } from "./live.ts";
import { createConsoleState, type ConsoleLiveMessage } from "./state.ts";

describe("console live Manifest feed", () => {
  test("pushes manifest and diff to subscribers", () => {
    const state = createConsoleState({ silentClaim: true, secret: "x" });
    const messages: ConsoleLiveMessage[] = [];
    const unsub = subscribeLive(state, (m) => messages.push(m));

    const a: Manifest = { oke: "1.0", app: "demo" };
    const b: Manifest = {
      oke: "1.0",
      app: "demo",
      flows: { "demo.ping": { plane: "user" } },
    };

    feedManifest(state, a);
    feedManifest(state, b);
    unsub();

    expect(messages.some((m) => m.type === "manifest")).toBe(true);
    expect(messages.some((m) => m.type === "manifest.diff")).toBe(true);
  });
});
