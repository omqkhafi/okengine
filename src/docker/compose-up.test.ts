/**
 * Unit tests for compose-up progress parsing / labels.
 */

import { describe, expect, test } from "bun:test";
import {
  composeUpPhaseLabel,
  composeUpPhaseStatus,
  formatComposeUpEventMessage,
  parseComposeProgressLine,
  shortenComposeTarget,
  stripAnsi,
} from "./compose-up.ts";

describe("parseComposeProgressLine", () => {
  test("parses Image / Container lifecycle lines", () => {
    expect(parseComposeProgressLine(" Image postgres:16-alpine Pulling ")).toEqual({
      raw: "Image postgres:16-alpine Pulling",
      target: "postgres:16-alpine",
      kind: "image",
      phase: "pulling",
    });
    expect(parseComposeProgressLine("Container oke-oke-2-postgres-1 Started")).toEqual({
      raw: "Container oke-oke-2-postgres-1 Started",
      target: "oke-oke-2-postgres-1",
      kind: "container",
      phase: "started",
    });
    expect(parseComposeProgressLine("Network oke-oke-2_default Creating")).toEqual({
      raw: "Network oke-oke-2_default Creating",
      target: "oke-oke-2_default",
      kind: "network",
      phase: "creating",
    });
  });

  test("parses bare service Pulling / Pulled", () => {
    expect(parseComposeProgressLine("postgres Pulling")).toEqual({
      raw: "postgres Pulling",
      target: "postgres",
      phase: "pulling",
    });
    expect(parseComposeProgressLine("redis Pulled")).toEqual({
      raw: "redis Pulled",
      target: "redis",
      phase: "pulled",
    });
  });

  test("parses download / extract / error chatter", () => {
    expect(parseComposeProgressLine("1f2544649a1a Downloading [====>] 5MB/12MB")?.phase).toBe(
      "downloading",
    );
    expect(parseComposeProgressLine("1f2544649a1a Extracting [========>]")?.phase).toBe(
      "extracting",
    );
    expect(parseComposeProgressLine("Error response from daemon: boom")?.phase).toBe("error");
  });

  test("keeps unknown lines as activity", () => {
    expect(parseComposeProgressLine("some compose note")).toEqual({
      raw: "some compose note",
      phase: "other",
      detail: "some compose note",
    });
  });

  test("skips empty / spinner-only", () => {
    expect(parseComposeProgressLine("   ")).toBeNull();
    expect(parseComposeProgressLine("…")).toBeNull();
  });

  test("strips ANSI before parse", () => {
    const line = "\x1b[32mContainer oke-x-redis-1 Started\x1b[0m";
    expect(parseComposeProgressLine(line)?.phase).toBe("started");
    expect(stripAnsi(line)).toBe("Container oke-x-redis-1 Started");
  });
});

describe("shortenComposeTarget / labels", () => {
  test("shortens oke container and image refs", () => {
    expect(shortenComposeTarget("oke-oke-2-postgres-1")).toBe("postgres");
    expect(shortenComposeTarget("postgres:16-alpine")).toBe("postgres");
    expect(shortenComposeTarget("ghcr.io/org/mailpit:latest")).toBe("mailpit");
  });

  test("formats event messages and status dots", () => {
    expect(
      formatComposeUpEventMessage({
        raw: "Image postgres:16 Pulling",
        target: "postgres:16",
        phase: "pulling",
      }),
    ).toBe("postgres pulling…");
    expect(composeUpPhaseLabel("started")).toBe("started");
    expect(composeUpPhaseStatus("pulling")).toBe("pending");
    expect(composeUpPhaseStatus("started")).toBe("ready");
    expect(composeUpPhaseStatus("error")).toBe("error");
  });
});
