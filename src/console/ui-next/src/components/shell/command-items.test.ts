import { describe, expect, test } from "bun:test";
import { consoleCommandItems } from "./command-items.ts";

describe("consoleCommandItems", () => {
  test("lists navigate, appearance, and account commands", () => {
    const items = consoleCommandItems({
      memory: {},
      go: () => undefined,
      openSettings: () => undefined,
      logout: () => undefined,
      setTheme: () => undefined,
    });
    expect(items.find((item) => item.id === "go:/overview")?.keys?.[1]).toBe("1");
    expect(items.find((item) => item.id === "go:/observability")?.keys?.[1]).toBe("4");
    expect(items.find((item) => item.id === "settings")?.keys?.[1]).toBe(",");
    expect(items.find((item) => item.id === "logout")?.keys?.[1]).toBe("E");
    expect(items.map((item) => item.id)).toEqual([
      "go:/overview",
      "go:/flows",
      "go:/store",
      "go:/observability",
      "go:/vault",
      "go:/access",
      "theme:light",
      "theme:dark",
      "theme:system",
      "settings",
      "logout",
    ]);
  });
});
