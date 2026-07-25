import { describe, expect, test } from "bun:test";
import { previewOffer } from "./dry-run.ts";
import { STORE_FIXTURE } from "./fixture.ts";

describe("previewOffer", () => {
  test("allows sql / kv / files", () => {
    expect(previewOffer(STORE_FIXTURE[0]!).ok).toBe(true);
    expect(previewOffer(STORE_FIXTURE[1]!).ok).toBe(true);
  });

  test("refuses index probe mutations", () => {
    const offer = previewOffer(STORE_FIXTURE[3]!);
    expect(offer.ok).toBe(false);
  });
});
