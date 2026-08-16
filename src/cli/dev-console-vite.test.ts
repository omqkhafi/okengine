/**
 * Console Vite attach — when `oke dev` should HMR ui-next.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONSOLE_VITE_ENV,
  resolveOkenginePackageRoot,
  shouldAttachConsoleVite,
  startConsoleVite,
} from "./dev-console-vite.ts";

describe("shouldAttachConsoleVite", () => {
  test("attaches on this source checkout by default", () => {
    expect(shouldAttachConsoleVite({ env: {} })).toBe(true);
  });

  test("OKE_CONSOLE_VITE=0 disables attach", () => {
    expect(shouldAttachConsoleVite({ env: { [CONSOLE_VITE_ENV]: "0" } })).toBe(false);
  });

  test("skips a node_modules install even when forced off the default", () => {
    expect(
      shouldAttachConsoleVite({
        packageRoot: "/tmp/app/node_modules/okengine",
        env: {},
      }),
    ).toBe(false);
  });

  test("skips when the Vite config is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-no-vite-config-"));
    expect(shouldAttachConsoleVite({ packageRoot: dir, env: {} })).toBe(false);
  });

  test("OKE_CONSOLE_VITE=1 still requires a Vite config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-force-vite-missing-"));
    expect(
      shouldAttachConsoleVite({
        packageRoot: dir,
        env: { [CONSOLE_VITE_ENV]: "1" },
      }),
    ).toBe(false);
    expect(
      shouldAttachConsoleVite({
        packageRoot: resolveOkenginePackageRoot(),
        env: { [CONSOLE_VITE_ENV]: "1" },
      }),
    ).toBe(true);
  });
});

describe("startConsoleVite", () => {
  test("serves /@vite/client without booting a second Console kernel", async () => {
    const vite = await startConsoleVite({
      consolePort: 6533,
      preferredPort: 18732,
    });
    try {
      expect(vite.port).toBeGreaterThan(0);
      const res = await fetch(`${vite.origin}/@vite/client`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text.length).toBeGreaterThan(0);
    } finally {
      await vite.stop();
    }
  }, 30_000);
});
