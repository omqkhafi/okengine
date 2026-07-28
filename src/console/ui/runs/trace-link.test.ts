/**
 * Runs ↔ Traces cross-link tests (console §9.11).
 */

import { describe, expect, test } from "bun:test";
import { RUNS_CHAIN_FIXTURE } from "./fixture.ts";
import {
  rootIdOf,
  runsHrefForSpan,
  shouldOfferTracesLink,
  spanCountInTrace,
  tracesHrefForRun,
} from "./trace-link.ts";

describe("trace cross-link", () => {
  test("multi-span chain offers Traces link", () => {
    expect(rootIdOf(RUNS_CHAIN_FIXTURE, "run-fulfill")).toBe("run-create-ok");
    expect(spanCountInTrace(RUNS_CHAIN_FIXTURE, "run-create-ok")).toBe(2);
    expect(shouldOfferTracesLink(RUNS_CHAIN_FIXTURE, "run-fulfill")).toBe(true);
    expect(shouldOfferTracesLink(RUNS_CHAIN_FIXTURE, "run-create-fail")).toBe(false);
    expect(tracesHrefForRun(RUNS_CHAIN_FIXTURE, "run-fulfill")).toBe(
      "/traces?trace=run-create-ok&span=run-fulfill",
    );
    expect(runsHrefForSpan("run-create-ok")).toBe("/runs?run=run-create-ok");
  });
});
