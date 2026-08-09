import { describe, expect, test } from "bun:test";
import { mapDevControlInput } from "./keys.ts";

describe("mapDevControlInput", () => {
  test("maps ? r q u x and aliases", () => {
    expect(mapDevControlInput("?", {})).toBe("?");
    expect(mapDevControlInput("h", {})).toBe("?");
    expect(mapDevControlInput("r", {})).toBe("r");
    expect(mapDevControlInput("q", {})).toBe("q");
    expect(mapDevControlInput("u", {})).toBe("u");
    expect(mapDevControlInput("x", {})).toBe("x");
    expect(mapDevControlInput("c", {})).toBeNull();
  });

  test("maps Ctrl+C to quit", () => {
    expect(mapDevControlInput("c", { ctrl: true })).toBe("q");
  });
});
