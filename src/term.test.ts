/**
 * Terminal chrome — color off stays plain; claim/banner keep structure.
 */

import { describe, expect, test } from "bun:test";
import {
  formatAppReadyLine,
  formatClaimNote,
  formatDevBanner,
  formatDevHero,
  formatDevLogSeparator,
  formatOkeWordmark,
  formatServiceLine,
  formatRequestLine,
  formatStackSummary,
  formatStatusLine,
  termStyle,
} from "./term.ts";

describe("term", () => {
  test("termStyle(false) strips ANSI", () => {
    const s = termStyle(false);
    expect(s.cyan).toBe("");
    expect(s.bold).toBe("");
  });

  test("formatOkeWordmark is block letters", () => {
    const out = formatOkeWordmark(false);
    expect(out).toContain("██");
    expect(out).toContain("╗");
  });

  test("formatDevBanner shows profile env system elements", () => {
    const out = formatDevBanner({
      color: false,
      version: "0.2.4",
      profile: "docker",
      runtimeEnv: "local",
      system: "darwin 25.4.0 · bun 1.3.14",
      elements: [
        { element: "flow", detail: "●" },
        { element: "store", detail: "sql postgres · kv redis" },
        { element: "signal", detail: "memory" },
      ],
    });
    expect(out).toContain("oke dev  v0.2.4");
    expect(out).toContain("profile");
    expect(out).toContain("docker");
    expect(out).toContain("env");
    expect(out).toContain("local");
    expect(out).toContain("system");
    expect(out).toContain("bun 1.3.14");
    expect(out).toContain("elements");
    expect(out).toContain("store");
    expect(out).toContain("postgres");
    expect(out).not.toContain("on(Trigger)");
    expect(out).not.toContain("O·K·E");
    expect(out).not.toMatch(/\u001b\[/);
  });

  test("formatServiceLine / formatAppReadyLine include URL", () => {
    expect(formatServiceLine("Console", "http://127.0.0.1:6533", false)).toContain(
      "http://127.0.0.1:6533",
    );
    expect(formatAppReadyLine("http://127.0.0.1:6530", false)).toContain("http://127.0.0.1:6530");
  });

  test("formatDevHero keeps App Console MCP URLs", () => {
    const out = formatDevHero({
      appUrl: "http://127.0.0.1:6530",
      consoleUrl: "http://127.0.0.1:6533",
      mcpUrl: "http://127.0.0.1:6535",
      profile: "local",
      runtimeEnv: "local",
      system: "darwin 25.4.0 · bun 1.3.14",
      elements: [{ element: "flow", detail: "●" }],
      color: false,
    });
    expect(out).toContain("oke dev");
    expect(out).toContain("██");
    expect(out).toContain("App");
    expect(out).toContain("Console");
    expect(out).toContain("MCP");
    expect(out).toContain("http://127.0.0.1:6530");
    expect(out).toContain("└");
    expect(out).toContain("Logs");
  });

  test("formatDevLogSeparator closes hero and titles Logs", () => {
    const out = formatDevLogSeparator(false);
    expect(out).toContain("│");
    expect(out).toContain("└");
    expect(out).toContain("Logs");
  });

  test("formatClaimNote embeds code and ownership line", () => {
    const code = "aabbccddeeff00112233445566778899";
    const out = formatClaimNote(code, false);
    expect(out).toContain(code);
    expect(out).toContain("Claim code");
    expect(out).toContain("owns the server");
    expect(out).not.toMatch(/\u001b\[/);
  });

  test("formatStatusLine keeps message", () => {
    expect(formatStatusLine("stack up (sql)", false)).toContain("stack up");
  });

  test("formatRequestLine shows date, time, surface, flow, ms, status", () => {
    const at = new Date(2026, 6, 26, 3, 11, 42);
    const out = formatRequestLine({
      surface: "App",
      method: "GET",
      path: "/health",
      flow: "main.health",
      status: 200,
      ms: 12,
      at,
      color: false,
    });
    expect(out).toContain("2026-07-26");
    expect(out).toContain("03:11:42");
    expect(out).toContain("App");
    expect(out).toContain("200");
    expect(out).not.toMatch(/\u001b\[/);
  });

  test("formatStackSummary is scannable", () => {
    const out = formatStackSummary({
      project: "oke-dev-a3f791",
      services: [
        { label: "postgres", hostPort: 15975 },
        { label: "redis", hostPort: 16975 },
      ],
      appDrivers: ["postgres", "redis"],
      color: false,
    });
    expect(out).toContain("Docker");
    expect(out).toContain(":15975");
    expect(out).not.toMatch(/\u001b\[/);
  });
});
