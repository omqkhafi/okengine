import { describe, expect, test } from "bun:test";
import { indexAdvisorEnableMode } from "./advisor-enable.ts";

describe("indexAdvisorEnableMode", () => {
  test("honest CTA when pg_available_extensions does not list index_advisor", () => {
    expect(indexAdvisorEnableMode({ available: false, installed: false })).toBe("cta");
  });

  test("Enable when the engine has the files but the extension is off", () => {
    expect(indexAdvisorEnableMode({ available: true, installed: false })).toBe("enable");
  });

  test("on when already installed", () => {
    expect(indexAdvisorEnableMode({ available: true, installed: true })).toBe("on");
  });
});
