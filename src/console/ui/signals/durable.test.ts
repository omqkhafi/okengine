import { describe, expect, test } from "bun:test";
import { durableLine } from "./durable.ts";

describe("durableLine", () => {
  test("durable consumer — resume at failed journal step", () => {
    const line = durableLine(true);
    expect(line.durable).toBe(true);
    expect(line.statement).toContain("resumes at the failed journal step");
    expect(line.statement).toContain("will not repeat");
  });

  test("non-durable — everything re-runs from the start", () => {
    const line = durableLine(false);
    expect(line.durable).toBe(false);
    expect(line.statement).toContain("re-runs from the start");
    expect(line.statement).toContain("durable: true");
  });

  test("no consumers", () => {
    expect(durableLine(null).statement).toContain("No consumer");
  });
});
