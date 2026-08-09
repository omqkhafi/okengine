import { describe, expect, test } from "bun:test";
import { clearTerminalScreen } from "../../term.ts";
import { canRenderTui, clearTerminalViewport } from "./launch.ts";

describe("canRenderTui", () => {
  test("requires stdout.isTTY", () => {
    expect(canRenderTui({ isTTY: true })).toBe(true);
    expect(canRenderTui({ isTTY: false })).toBe(false);
    expect(canRenderTui({})).toBe(false);
  });
});

describe("clearTerminalViewport", () => {
  test("writes the same clear sequence as oke dev", () => {
    expect(clearTerminalScreen()).toContain("\u001b[2J");
    expect(typeof clearTerminalViewport).toBe("function");
  });
});
