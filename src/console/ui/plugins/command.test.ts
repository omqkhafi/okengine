/**
 * Copyable command — never an install button affordance.
 */

import { describe, expect, test } from "bun:test";
import { copyCommandLabel, copyableCommand } from "./command.ts";
import { PLUGINS_LIST_FIXTURE } from "./fixture.ts";

describe("copyableCommand", () => {
  test("community hands bun add; core off hands enable hint", () => {
    const community = PLUGINS_LIST_FIXTURE.plugins.find((p) => p.id === "oke-slack")!;
    expect(copyableCommand(community)).toBe("bun add oke-slack");
    expect(copyCommandLabel(community)).toBe("Copy bun add command");

    const rate = PLUGINS_LIST_FIXTURE.plugins.find((p) => p.id === "rate-limit")!;
    expect(copyableCommand(rate)).toContain("rateLimit");
    expect(copyCommandLabel(rate)).toBe("Copy enable hint");

    const auth = PLUGINS_LIST_FIXTURE.plugins.find((p) => p.id === "auth")!;
    expect(copyableCommand(auth)).toBeNull();
  });
});
