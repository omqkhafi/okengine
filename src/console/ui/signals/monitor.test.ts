import { describe, expect, test } from "bun:test";
import {
  appendLivePayload,
  createLiveMonitor,
  exportLivePayloads,
  onMonitorScroll,
  setPaused,
} from "./monitor.ts";

describe("live monitor", () => {
  test("appends while running and freezes when paused", () => {
    let state = createLiveMonitor([{ a: 1 }]);
    state = appendLivePayload(state, { a: 2 });
    expect(state.payloads).toHaveLength(2);
    state = setPaused(state, true);
    state = appendLivePayload(state, { a: 3 });
    expect(state.payloads).toHaveLength(2);
  });

  test("scroll auto-pauses", () => {
    const state = onMonitorScroll(createLiveMonitor());
    expect(state.paused).toBe(true);
    expect(state.autoPausedByScroll).toBe(true);
  });

  test("export is JSON", () => {
    const json = exportLivePayloads([{ x: 1 }]);
    expect(JSON.parse(json)).toEqual([{ x: 1 }]);
  });
});
