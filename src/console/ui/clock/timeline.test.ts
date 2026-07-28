/**
 * Forward timeline helpers.
 */

import { describe, expect, test } from "bun:test";
import { CLOCK_LIST_FIXTURE } from "./fixture.ts";
import { formatTimelineWhen, forwardTimeline } from "./timeline.ts";

describe("forwardTimeline", () => {
  test("keeps next-24h events sorted", () => {
    const now = CLOCK_LIST_FIXTURE.now;
    const events = forwardTimeline(
      [
        ...CLOCK_LIST_FIXTURE.timeline,
        {
          at: now + 48 * 3_600_000,
          kind: "cron",
          name: "too-far",
        },
        {
          at: now - 1,
          kind: "wake",
          name: "past",
        },
      ],
      now,
    );
    expect(events.every((e) => e.at >= now && e.at < now + 86_400_000)).toBe(true);
    expect(events.find((e) => e.name === "too-far")).toBeUndefined();
    expect(events.find((e) => e.name === "past")).toBeUndefined();
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.at).toBeGreaterThanOrEqual(events[i - 1]!.at);
    }
  });
});

describe("formatTimelineWhen", () => {
  test("formats relative wake", () => {
    expect(formatTimelineWhen(60_000, 0)).toBe("in 1m");
    expect(formatTimelineWhen(3_600_000, 0)).toBe("in 1h");
  });
});
