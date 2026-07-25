/**
 * Top-level help — no Flags/JSON comment footers.
 */

import { describe, expect, test } from "bun:test";
import { formatOkeHelp } from "./registry.ts";

describe("formatOkeHelp", () => {
  test("lists commands without Flags/JSON commentary", () => {
    const help = formatOkeHelp();
    expect(help).toContain("oke — okengine CLI");
    expect(help).toContain("Commands:");
    expect(help).toContain("dev");
    expect(help).not.toContain("Flags:");
    expect(help).not.toContain("JSON:");
    expect(help).not.toContain("Exit codes:");
  });
});
