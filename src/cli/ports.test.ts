/**
 * Dev port probing — prefer then +1 until free.
 */

import { describe, expect, test } from "bun:test";
import { findFreePort, resolveDevPorts } from "./ports.ts";

describe("findFreePort", () => {
  test("returns preferred when free", async () => {
    const port = await findFreePort(6530, new Set(), async () => false);
    expect(port).toBe(6530);
  });

  test("increments until free", async () => {
    const busy = new Set([6530, 6531]);
    const port = await findFreePort(6530, new Set(), async (p) => busy.has(p));
    expect(port).toBe(6532);
  });

  test("skips occupied set even when probe says free", async () => {
    const port = await findFreePort(6530, new Set([6530, 6531]), async () => false);
    expect(port).toBe(6532);
  });

  test("passes through ephemeral 0", async () => {
    expect(await findFreePort(0)).toBe(0);
  });
});

describe("resolveDevPorts", () => {
  test("keeps app · console · mcp distinct when preferred collide", async () => {
    // Everything busy except 6531, 6534, 6536 — force increments.
    const busy = new Set([6530, 6533, 6535]);
    const ports = await resolveDevPorts({ app: 6530, console: 6533, mcp: 6535 }, async (p) =>
      busy.has(p),
    );
    expect(ports.app).toBe(6531);
    expect(ports.console).toBe(6534);
    expect(ports.mcp).toBe(6536);
    expect(new Set([ports.app, ports.console, ports.mcp]).size).toBe(3);
  });
});
