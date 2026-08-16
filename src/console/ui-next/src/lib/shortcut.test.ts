import { describe, expect, test } from "bun:test";
import {
  consoleShortcut,
  isMacPlatform,
  isTypingTarget,
  MODULE_DIGIT_PATH,
  modChord,
  modKey,
} from "./shortcut.ts";

describe("consoleShortcut", () => {
  test("fast and settings are modifier chords", () => {
    expect(consoleShortcut("fast")).toEqual(modChord("K"));
    expect(consoleShortcut("settings")).toEqual(modChord(","));
    expect(consoleShortcut("logout")).toEqual(modChord("E"));
  });

  test("modules are ⌘1…⌘N in sidebar order", () => {
    expect(consoleShortcut("overview")).toEqual(modChord("1"));
    expect(consoleShortcut("flows")).toEqual(modChord("2"));
    expect(consoleShortcut("store")).toEqual(modChord("3"));
    expect(consoleShortcut("observability")).toEqual(modChord("4"));
    expect(consoleShortcut("vault")).toEqual(modChord("5"));
  });

  test("digits map to module paths", () => {
    expect(MODULE_DIGIT_PATH["1"]).toBe("/overview");
    expect(MODULE_DIGIT_PATH["2"]).toBe("/flows");
    expect(MODULE_DIGIT_PATH["3"]).toBe("/store");
    expect(MODULE_DIGIT_PATH["4"]).toBe("/observability");
    expect(MODULE_DIGIT_PATH["5"]).toBe("/vault");
  });
});

describe("isMacPlatform", () => {
  test("uses Client Hints when present", () => {
    expect(isMacPlatform({ userAgentData: { platform: "macOS" } })).toBe(true);
    expect(isMacPlatform({ userAgentData: { platform: "Windows" } })).toBe(false);
  });

  test("falls back to userAgent when platform is empty", () => {
    expect(
      isMacPlatform({
        platform: "",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      }),
    ).toBe(true);
    expect(
      isMacPlatform({
        platform: "",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      }),
    ).toBe(false);
  });
});

describe("modKey", () => {
  test("is ⌘ on Mac and Ctrl on Windows", () => {
    expect(modKey({ userAgentData: { platform: "macOS" } })).toBe("⌘");
    expect(modKey({ userAgentData: { platform: "Windows" } })).toBe("Ctrl");
    expect(modChord("K", { userAgentData: { platform: "macOS" } })).toEqual(["⌘", "K"]);
    expect(modChord("K", { userAgentData: { platform: "Windows" } })).toEqual(["Ctrl", "K"]);
  });
});

describe("isTypingTarget", () => {
  test("ignores null", () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});
