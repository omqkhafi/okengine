/**
 * Manifest live feed — subscribers receive snapshot + diff.
 */

import { describe, expect, test } from "bun:test";
import type { Manifest } from "../../manifest/types.ts";
import type { WideEvent } from "../../runs/types.ts";
import { feedManifest, feedRun, subscribeLive } from "./live.ts";
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

describe("console live run feed", () => {
  const run: WideEvent = {
    id: "run_1",
    parentId: undefined,
    flow: "demo.ping",
    unit: "demo",
    trigger: "http",
    plane: "operator",
    gates: [],
    cache: "none",
    effects: [],
    logs: [],
    durationMs: 3,
    startedAt: 1,
    endedAt: 4,
    dimensions: {},
  };

  test("pushes a projected run to subscribers", () => {
    const state = createConsoleState({ silentClaim: true, secret: "x" });
    const messages: ConsoleLiveMessage[] = [];
    const unsub = subscribeLive(state, (m) => messages.push(m));

    feedRun(state, run);
    unsub();

    const msg = messages.find((m) => m.type === "run");
    expect(msg).toBeDefined();
    if (msg?.type === "run") {
      expect(msg.run.id).toBe("run_1");
      expect(msg.run.flow).toBe("demo.ping");
      expect(msg.run.error).toBeNull();
    }
  });

  test("skips projection when no subscribers", () => {
    const state = createConsoleState({ silentClaim: true, secret: "x" });
    // No subscribers — should be a no-op (and not throw).
    expect(() => feedRun(state, run)).not.toThrow();
  });
});
