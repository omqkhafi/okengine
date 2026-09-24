/**
 * Commands named in the agent contract must exist on the CLI.
 */

import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { commandNames } from "./registry.ts";

describe("AGENTS.md commands", () => {
  test("every oke command mentioned in AGENTS.md is registered", () => {
    const text = readFileSync(new URL("../../AGENTS.md", import.meta.url), "utf8");
    const registered = new Set(commandNames());
    const mentioned = new Set<string>();
    for (const match of text.matchAll(/`oke ([a-z][a-z0-9-]*)/g)) {
      const name = match[1];
      if (name) mentioned.add(name);
    }
    expect(mentioned.has("eval")).toBe(true);
    expect(mentioned.has("decide")).toBe(true);
    expect(text).not.toContain("oke decide certify");
    for (const name of mentioned) {
      expect(registered.has(name)).toBe(true);
    }
  });
});
