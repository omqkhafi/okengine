/**
 * Terminal chrome — color off stays plain; claim/banner keep structure.
 */

import { describe, expect, test } from "bun:test";
import {
  formatAppReadyLine,
  formatClaimNote,
  formatDevBanner,
  formatServiceLine,
  formatStatusLine,
  termStyle,
} from "./term.ts";

describe("term", () => {
  test("termStyle(false) strips ANSI", () => {
    const s = termStyle(false);
    expect(s.cyan).toBe("");
    expect(s.bold).toBe("");
  });

  test("formatDevBanner is readable without color", () => {
    const out = formatDevBanner({ color: false });
    expect(out).toContain("oke dev");
    expect(out).toContain("Starting");
    expect(out).toContain("watching");
    expect(out).not.toMatch(/\u001b\[/);
  });

  test("formatServiceLine / formatAppReadyLine include URL", () => {
    expect(formatServiceLine("Console", "http://127.0.0.1:6533", false)).toContain(
      "http://127.0.0.1:6533",
    );
    expect(formatAppReadyLine("http://127.0.0.1:6530", false)).toContain(
      "http://127.0.0.1:6530",
    );
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
});
