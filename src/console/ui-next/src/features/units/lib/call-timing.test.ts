/**
 * Unit tests for {@link callTiming}.
 */

import { describe, expect, test } from "bun:test";
import { callTiming } from "./call-timing.ts";

describe("callTiming", () => {
  test("prefers handler duration over browser RTT", () => {
    expect(callTiming({ handlerMs: 0.37, rttMs: 18 })).toEqual({
      primaryMs: 0.37,
      primaryKind: "handler",
      rttMs: 18,
    });
  });

  test("falls back to RTT when the host did not report duration", () => {
    expect(callTiming({ rttMs: 18 })).toEqual({
      primaryMs: 18,
      primaryKind: "rtt",
      rttMs: 18,
    });
  });

  test("returns null when nothing settled", () => {
    expect(callTiming({ rttMs: null })).toBeNull();
  });
});
