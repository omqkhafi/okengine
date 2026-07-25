/**
 * Fallback weekly cost copy.
 */

import { describe, expect, test } from "bun:test";
import { formatFallbackLine } from "./fallback.ts";
import { CHANNELS_LIST_FIXTURE } from "./fixture.ts";

describe("formatFallbackLine", () => {
  test("includes chain and weekly bill", () => {
    const line = formatFallbackLine(CHANNELS_LIST_FIXTURE.fallback);
    expect(line).toContain("whatsapp failed → sms succeeded");
    expect(line).toContain("$38 / week above whatsapp-only");
  });
});
