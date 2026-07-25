/**
 * `oke completion` is generated from the command registry.
 */

import { describe, expect, test } from "bun:test";
import { generateCompletion } from "./completion.ts";
import {
  OKE_COMMANDS,
  commandNames,
  type CliCommand,
} from "./registry.ts";

describe("oke completion", () => {
  test("bash script lists every registry command", () => {
    const script = generateCompletion("bash");
    for (const name of commandNames()) {
      expect(script).toContain(name);
    }
    expect(script).toContain("--json");
    expect(script).toContain("-j");
  });

  test("zsh and fish scripts list every registry command", () => {
    for (const shell of ["zsh", "fish"] as const) {
      const script = generateCompletion(shell);
      for (const name of commandNames()) {
        expect(script).toContain(name);
      }
    }
  });

  test("adding a registry command appears in completion without editing the generator", () => {
    const extended: CliCommand[] = [
      ...OKE_COMMANDS,
      {
        name: "brand-new-cmd",
        summary: "prove registry drives completion",
        leaf: true,
        flags: [{ long: "--help", short: "-h", summary: "help" }],
      },
    ];
    const bash = generateCompletion("bash", extended);
    const zsh = generateCompletion("zsh", extended);
    const fish = generateCompletion("fish", extended);
    expect(bash).toContain("brand-new-cmd");
    expect(zsh).toContain("brand-new-cmd");
    expect(fish).toContain("brand-new-cmd");
    // Default registry must not already include the probe name.
    expect(commandNames()).not.toContain("brand-new-cmd");
  });

  test("subcommand flags are present (images list --json)", () => {
    const script = generateCompletion("bash");
    expect(script).toContain("list");
    expect(script).toContain("pin");
    expect(script).toMatch(/images[\s\S]*list[\s\S]*--json/);
  });
});
