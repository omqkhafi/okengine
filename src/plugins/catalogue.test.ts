/**
 * CORE catalogue state derivation.
 */

import { describe, expect, test } from "bun:test";
import {
  CORE_PLUGINS,
  isCorePluginOn,
  isPrivacyConfigured,
  isTenancyConfigured,
} from "./catalogue.ts";

describe("CORE catalogue", () => {
  test("lists auth, console, rate-limit, tenancy, privacy", () => {
    expect(CORE_PLUGINS.map((p) => p.id)).toEqual([
      "auth",
      "console",
      "rate-limit",
      "tenancy",
      "privacy",
    ]);
  });

  test("plug-based state for auth/console/rate-limit", () => {
    const plugged = new Set(["auth", "console"]);
    expect(isCorePluginOn("auth", null, null, plugged)).toBe(true);
    expect(isCorePluginOn("console", null, null, plugged)).toBe(true);
    expect(isCorePluginOn("rate-limit", null, null, plugged)).toBe(false);
  });

  test("tenancy from config or Manifest", () => {
    expect(isTenancyConfigured(null, { tenancy: { isolation: "row" } })).toBe(true);
    expect(isTenancyConfigured({ oke: "1.0", app: "x", tenancy: { isolation: "row" } }, null)).toBe(
      true,
    );
    expect(isTenancyConfigured(null, null)).toBe(false);
  });

  test("privacy from privacy block or runs.redact", () => {
    expect(isPrivacyConfigured({ privacy: {} })).toBe(true);
    expect(isPrivacyConfigured({ runs: { redact: { email: "7y" } } })).toBe(true);
    expect(isPrivacyConfigured({})).toBe(false);
  });
});
