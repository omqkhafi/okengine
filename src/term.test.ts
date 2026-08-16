/**
 * Terminal chrome — color off stays plain; claim/banner keep structure.
 */

import { describe, expect, test } from "bun:test";
import {
  formatAppReadyLine,
  formatBootWarn,
  formatClaimNote,
  formatDevNote,
  formatCliChrome,
  formatDevBanner,
  formatDevHero,
  formatDevLogSeparator,
  formatOkeWordmark,
  formatServiceLine,
  formatRequestLine,
  formatStackSummary,
  countTermLines,
  createAnchoredBoard,
  formatStatusDot,
  formatStatusLine,
  grownBoardTail,
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
        { element: "flow", detail: "", status: "ready" },
        { element: "store", detail: "sql postgres · kv redis", status: "ready" },
        { element: "signal", detail: "memory", status: "ready" },
        { element: "ai", detail: "openai-compatible · granite3.3:2b", status: "pending" },
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
    expect(out).toContain("● flow");
    expect(out).toContain("● ai");
    expect(out).toContain("Starting");
    expect(out).not.toContain("Ready");
    expect(out).not.toContain("on(Trigger)");
    expect(out).not.toContain("O·K·E");
    expect(out).not.toMatch(/\u001b\[/);
  });

  test("formatDevBanner phase ready says Ready", () => {
    const out = formatDevBanner({ color: false, phase: "ready", version: "0.2.4" });
    expect(out).toContain("Ready");
    expect(out).not.toContain("Starting");
  });

  test("formatStatusDot colors by status", () => {
    const s = termStyle(true);
    expect(formatStatusDot("ready", true)).toBe(`${s.green}●${s.reset}`);
    expect(formatStatusDot("pending", true)).toBe(`${s.yellow}●${s.reset}`);
    expect(formatStatusDot("error", true)).toBe(`${s.red}●${s.reset}`);
    expect(formatStatusDot("idle", true)).toBe(`${s.dim}●${s.reset}`);
    expect(formatStatusDot("ready", false)).toBe("●");
  });

  test("countTermLines counts rows", () => {
    expect(countTermLines("a\nb\n")).toBe(2);
    expect(countTermLines("")).toBe(0);
  });

  test("grownBoardTail returns only the new rows", () => {
    expect(grownBoardTail("a\nb\n", "a\nb\nCLAIM\n")).toBe("CLAIM\n");
    expect(grownBoardTail("a\nb\n", "a\nb\n")).toBe("");
  });

  test("createAnchoredBoard appends growth when rewrite is off", () => {
    const chunks: string[] = [];
    const board = createAnchoredBoard((t) => {
      chunks.push(t);
    }, false);
    board.paint("one\ntwo\n");
    board.paint("one\ntwo\nCLAIM\n");
    expect(chunks.join("")).toBe("one\ntwo\nCLAIM\n");
  });

  test("createAnchoredBoard inserts rows when the board grows under output", () => {
    const chunks: string[] = [];
    const board = createAnchoredBoard((t) => {
      chunks.push(t);
    }, true);
    board.paint("A\nB\n");
    const wrapped = board.wrapWrite((t) => {
      chunks.push(t);
    });
    wrapped("url\n");
    board.paint("A\nB\nCLAIM\n");
    const out = chunks.join("");
    expect(out).toContain("\x1b[1L");
    expect(out).toContain("CLAIM");
    expect(out).toContain("url\n");
  });

  test("formatServiceLine / formatAppReadyLine include URL", () => {
    expect(formatServiceLine("Console", "http://127.0.0.1:6533", false)).toContain(
      "http://127.0.0.1:6533",
    );
    expect(formatAppReadyLine("http://127.0.0.1:6530", false)).toContain("http://127.0.0.1:6530");
  });

  test("formatDevHero keeps Backend Console MCP URLs", () => {
    const out = formatDevHero({
      appUrl: "http://127.0.0.1:6530",
      consoleUrl: "http://127.0.0.1:6533",
      mcpUrl: "http://127.0.0.1:6535",
      profile: "local",
      runtimeEnv: "local",
      system: "darwin 25.4.0 · bun 1.3.14",
      elements: [{ element: "flow", detail: "", status: "ready" }],
      color: false,
    });
    expect(out).toContain("oke dev");
    expect(out).toContain("██");
    expect(out).toContain("Backend");
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
    expect(out).toContain("oke console claim-code");
    expect(out).toContain("owns the server");
    expect(out).not.toMatch(/\u001b\[/);
  });

  test("formatClaimNote can point at the Console URL", () => {
    const out = formatClaimNote("aabbccddeeff00112233445566778899", false, {
      consoleUrl: "http://127.0.0.1:6533",
    });
    expect(out).toContain("Paste at http://127.0.0.1:6533");
  });

  test("formatStatusLine keeps message", () => {
    expect(formatStatusLine("stack up (sql)", false)).toContain("stack up");
  });

  test("formatBootWarn wraps under Notice chrome", () => {
    const out = formatBootWarn(
      "oke boot: Channel suppression defaults to process-local memory for multi-instance",
      false,
    );
    expect(out).toContain("Notice");
    expect(out).toContain("process-local");
    expect(out).not.toContain("oke boot:");
    expect(out).toMatch(/◇ {2}Notice\n│\n│ {2}Channel/);
  });

  test("formatDevNote colors the title chip and body", () => {
    const warn = formatDevNote({
      title: "Notice",
      body: "open capability",
      tone: "warn",
      color: true,
    });
    const err = formatDevNote({
      title: "500",
      body: "boom",
      tone: "error",
      color: true,
    });
    expect(warn).toContain("\u001b[33m");
    expect(err).toContain("\u001b[31m");
    expect(warn).toContain("\u001b[1m");
  });

  test("formatCliChrome routes boot and status lines", () => {
    const out = formatCliChrome("oke db seed: ok\noke boot: hello world\n", false);
    expect(out).toContain("oke db seed: ok");
    expect(out).toContain("Notice");
    expect(out).toContain("hello world");
  });

  test("formatRequestLine shows date, time, surface, flow, ms, status", () => {
    const at = new Date(2026, 6, 26, 3, 11, 42);
    const out = formatRequestLine({
      surface: "Backend",
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
    expect(out).toContain("Backend");
    expect(out).toContain("200");
    expect(out).not.toMatch(/\u001b\[/);
  });

  test("formatRequestLine appends run id after time", () => {
    const at = new Date(2026, 6, 26, 3, 11, 42);
    const out = formatRequestLine({
      surface: "Console",
      method: "GET",
      path: "/console/vault",
      flow: "console.vault.list",
      status: 200,
      ms: 5,
      runId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      at,
      color: false,
    });
    expect(out).toContain("03:11:42  a1b2c3d4-e5f6-7890-abcd-ef1234567890");
  });

  test("formatRequestLine prints failure detail under 4xx/5xx", () => {
    const out = formatRequestLine({
      surface: "Console",
      method: "POST",
      path: "/console/setup/claim",
      flow: "console.setup.claim",
      status: 400,
      ms: 1,
      detail: "Password needs at least 12 characters, including a letter and a number.",
      color: false,
    });
    expect(out).toContain("400");
    expect(out).toContain("Password needs at least 12 characters");
    expect(out).toMatch(/◇ {2}400\n│\n│ {2}Password/);
    expect(out).not.toContain("↳");
  });

  test("formatStackSummary is scannable", () => {
    const out = formatStackSummary({
      project: "oke-dev-a3f791",
      services: [
        { label: "postgres", hostPort: 15975, status: "ready" },
        { label: "redis", hostPort: 16975, status: "ready" },
        { label: "ai", hostPort: 23975, detail: "gemma4:e4b-q4_K_M", status: "pending" },
      ],
      appDrivers: ["postgres", "redis"],
      color: false,
    });
    expect(out).toContain("Docker");
    expect(out).toContain(":15975");
    expect(out).toContain("gemma4:e4b-q4_K_M");
    expect(out).toContain("● postgres");
    expect(out).toContain("● ai");
    // Blank │ row separates the Docker header from whatever sits above.
    expect(out).toMatch(/│\n◇ {2}Docker/);
    expect(out).not.toMatch(/\u001b\[/);
  });
});
