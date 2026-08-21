/**
 * Manifest live feed — subscribers receive snapshot + diff.
 */

import { describe, expect, test } from "bun:test";
import type { Manifest } from "../../manifest/types.ts";
import type { WideEvent } from "../../runs/types.ts";
import { feedManifest, feedRun, subscribeLive } from "./live.ts";
import { createConsoleState, setManifest, type ConsoleLiveMessage } from "./state.ts";

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

  test("seeded identities follow the Manifest — no invented booking:create", () => {
    const state = createConsoleState({ silentClaim: true, secret: "x" });
    expect(state.identities).toHaveLength(10);
    expect(state.identities[0]?.id).toBe("user_demo");
    expect(state.identities.find((row) => row.id === "user_member")?.scopes).toEqual(["member"]);
    expect(state.identities.find((row) => row.id === "user_guest")?.scopes).toEqual([]);
    expect(state.identities.find((row) => row.id === "user_demo")?.scopes).toEqual(["member"]);

    setManifest(state, {
      oke: "1.0",
      app: "keel-like",
      gates: {
        member: { kind: "policy", scopes: ["member"] },
        "task:write": { kind: "policy", scopes: ["task:write"] },
      },
    });
    expect(state.identities.find((row) => row.id === "user_demo")?.scopes).toEqual([
      "member",
      "task:write",
    ]);
    expect(state.identities.find((row) => row.id === "user_demo")?.scopes).not.toContain(
      "booking:create",
    );
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
