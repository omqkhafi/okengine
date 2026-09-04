/**
 * App-wide Clock timezone — `oke({ clock })` / `defineConfig({ clock })`.
 */

import { describe, expect, test } from "bun:test";

import { clock, resetClocks } from "../elements/clock/declare.ts";
import { defineConfig } from "../config/index.ts";
import { bootApplication } from "./boot.ts";
import { oke } from "./app.ts";
import { resetBindings } from "./on.ts";

describe("oke({ clock: { timezone } })", () => {
  test("applies to clocks that omit timezone; explicit wins", async () => {
    resetBindings();
    resetClocks();

    clock.daily("local", { at: "06:00" });
    clock.daily("ny", { at: "09:00", timezone: "America/New_York" });

    const app = oke({
      name: "tz-oke",
      autoBoot: false,
      startScheduler: false,
      clock: { timezone: "Asia/Riyadh" },
    });

    expect(app.$options.clocks?.find((c) => c.name === "local")?.timezone).toBe("Asia/Riyadh");
    expect(app.$options.clocks?.find((c) => c.name === "ny")?.timezone).toBe("America/New_York");

    await app.boot({ env: "test" });
    expect(app.bootResult?.clock?.declarations.get("local")?.timezone).toBe("Asia/Riyadh");
    expect(app.bootResult?.clock?.declarations.get("ny")?.timezone).toBe("America/New_York");
    await app.bootResult?.close();
  });

  test("defineConfig({ clock: { timezone } }) applies at bind when oke omits it", async () => {
    resetBindings();
    resetClocks();

    const digest = clock.daily("digest", { at: "08:00" });
    expect(digest.timezoneDefaulted).toBe(true);

    const result = await bootApplication({
      env: "test",
      clocks: [digest],
      config: defineConfig({
        clock: { timezone: "Asia/Riyadh" },
        drivers: { clock: { test: "frozen" } },
      }),
    });
    try {
      expect(result.clock?.declarations.get("digest")?.timezone).toBe("Asia/Riyadh");
    } finally {
      await result.close();
    }
  });

  test("oke({ clock }) wins over defineConfig", async () => {
    resetBindings();
    resetClocks();

    clock.daily("digest", { at: "08:00" });

    const app = oke({
      name: "tz-precedence",
      autoBoot: false,
      startScheduler: false,
      clock: { timezone: "Europe/Berlin" },
      config: defineConfig({
        clock: { timezone: "Asia/Riyadh" },
      }),
    });

    expect(app.$options.clocks?.[0]?.timezone).toBe("Europe/Berlin");
    await app.boot({ env: "test" });
    expect(app.bootResult?.clock?.declarations.get("digest")?.timezone).toBe("Europe/Berlin");
    await app.bootResult?.close();
  });
});
