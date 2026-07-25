/**
 * Locale chain + RTL.
 */

import { describe, expect, test } from "bun:test";
import { dirForLocale, formatLocaleChainDisplay } from "./locale.ts";

describe("locale display", () => {
  test("formats chain and detects RTL", () => {
    expect(
      formatLocaleChainDisplay(["profile:ar", "default:en"]),
    ).toBe("profile:ar → default:en");
    expect(dirForLocale("ar")).toBe("rtl");
    expect(dirForLocale("ar-SA")).toBe("rtl");
    expect(dirForLocale("en")).toBe("ltr");
  });
});
