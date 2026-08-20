import { describe, expect, test } from "bun:test";
import {
  createDevControlDispatcher,
  formatDevControlsHelp,
  formatDevControlsHint,
  parseDevControlKey,
} from "./dev-controls.ts";

const CTRL_C = String.fromCharCode(3);

describe("dev-controls", () => {
  test("parseDevControlKey maps raw keys", () => {
    expect(parseDevControlKey("q")).toBe("q");
    expect(parseDevControlKey("?")).toBe("?");
    expect(parseDevControlKey("h")).toBe("?");
    expect(parseDevControlKey("r")).toBe("r");
    expect(parseDevControlKey("s")).toBe("s");
    expect(parseDevControlKey("u")).toBe("u");
    expect(parseDevControlKey("x")).toBe("x");
    expect(parseDevControlKey("c")).toBeNull();
    expect(parseDevControlKey("l")).toBeNull();
    expect(parseDevControlKey("3")).toBeNull();
    expect(parseDevControlKey("")).toBeNull();
    expect(parseDevControlKey("z")).toBeNull();
  });

  test("parseDevControlKey maps Ctrl+C to quit", () => {
    expect(parseDevControlKey(CTRL_C)).toBe("q");
  });

  test("format hint and help are scannable", () => {
    expect(formatDevControlsHint(false)).toContain("keys");
    expect(formatDevControlsHint(false)).toContain("refresh");
    expect(formatDevControlsHint(false)).toContain("quit");
    expect(formatDevControlsHint(false)).not.toContain("services");
    expect(formatDevControlsHelp(false)).toContain("refresh");
    expect(formatDevControlsHint(false)).toContain("seed");
    expect(formatDevControlsHelp(false)).toContain("oke db seed");
    expect(formatDevControlsHelp(false)).not.toContain("select service");
  });

  test("dispatcher up -> stop -> refresh -> help -> quit", async () => {
    const calls: string[] = [];
    let quit = false;
    let settled = 0;
    let refreshed = 0;
    let panels = 0;
    const d = createDevControlDispatcher({
      write: () => {},
      onQuit: () => {
        quit = true;
      },
      onRefresh: () => {
        refreshed += 1;
      },
      onShowPanel: () => {
        panels += 1;
      },
      onComposeSettled: () => {
        settled += 1;
      },
      composeAction: async (action) => {
        calls.push(action);
      },
    });
    d.handleKey("u");
    await Bun.sleep(10);
    d.handleKey("x");
    await Bun.sleep(10);
    d.handleKey("r");
    await Bun.sleep(10);
    d.handleKey("?");
    await Bun.sleep(10);
    d.handleKey("q");
    expect(calls).toEqual(["up", "stop"]);
    expect(settled).toBe(2);
    expect(refreshed).toBe(1);
    expect(panels).toBe(1);
    expect(quit).toBe(true);
    d.stop();
  });

  test("dispatcher s runs onSeed", async () => {
    let seeded = 0;
    const d = createDevControlDispatcher({
      write: () => {},
      onQuit: () => {},
      onSeed: () => {
        seeded += 1;
      },
      composeAction: async () => {},
    });
    d.handleKey("s");
    await Bun.sleep(10);
    expect(seeded).toBe(1);
    d.stop();
  });

  test("busy compose action ignores a concurrent key press", async () => {
    let running = 0;
    let maxConcurrent = 0;
    const calls: string[] = [];
    const d = createDevControlDispatcher({
      write: () => {},
      onQuit: () => {},
      composeAction: async (action) => {
        running += 1;
        maxConcurrent = Math.max(maxConcurrent, running);
        await Bun.sleep(20);
        calls.push(action);
        running -= 1;
      },
    });
    d.handleKey("u");
    d.handleKey("x");
    await Bun.sleep(40);
    expect(calls).toEqual(["up"]);
    expect(maxConcurrent).toBe(1);
    d.stop();
  });
});
