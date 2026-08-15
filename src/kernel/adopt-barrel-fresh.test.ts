/**
 * Boot-level proof: a `src/flows/<unit>` folder on disk with no adopted
 * flow under that unit — the stale/missing `.adopt()` barrel case.
 *
 * Mirrors `effects-stamping.test.ts`'s OKE1008 shape exactly: opt-in only
 * via `rootDir`, `test` warns once (dev-loop stays unbroken),
 * `dev`+compose / `prod` hard-fail (`OKE1009`) — never a silently-incomplete route
 * table in a deploy-shaped environment.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertAdoptBarrelFresh, resetStaleAdoptBarrelWarnForTests } from "./boot.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { on, resetBindings } from "./on.ts";
import { http } from "./triggers.ts";
import { oke } from "./app.ts";

afterEach(() => {
  resetBindings();
  resetFlowSeq();
  resetStaleAdoptBarrelWarnForTests();
});

async function makeUnitDir(root: string, unit: string): Promise<void> {
  const dir = join(root, "src/flows", unit);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.ts"), "export const nothing = 1;\n");
}

describe("assertAdoptBarrelFresh — direct", () => {
  test("no rootDir: no-op, never reads the filesystem", async () => {
    await expect(assertAdoptBarrelFresh([], "prod", undefined)).resolves.toBeUndefined();
  });

  test("fresh: every disk unit has an adopted flow — no warn, no throw, any env", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-adopt-fresh-"));
    try {
      await makeUnitDir(root, "notes");
      const notesFlow = flow("notes.create", { do: () => ({ ok: true as const }) });
      await expect(assertAdoptBarrelFresh([notesFlow], "dev", root, true)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("stale: unit on disk, zero adopted flows for it — dev+compose hard-fails OKE1009", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-adopt-fresh-"));
    try {
      await makeUnitDir(root, "notes");
      await expect(assertAdoptBarrelFresh([], "dev", root, true)).rejects.toThrow(/OKE1009/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("stale: prod — same posture as dev+compose", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-adopt-fresh-"));
    try {
      await makeUnitDir(root, "notes");
      await expect(assertAdoptBarrelFresh([], "prod", root)).rejects.toThrow(/OKE1009/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("stale: test — warns, never throws (dev-loop stays unbroken)", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-adopt-fresh-"));
    try {
      await makeUnitDir(root, "notes");
      await expect(assertAdoptBarrelFresh([], "test", root)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("boot-level: stale barrel through a real oke() boot", () => {
  test("dev+compose: real app.boot() hard-fails OKE1009 when a unit folder was never adopted", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-adopt-fresh-"));
    try {
      // "notes" exists on disk but this app only ever adopted "main" —
      // exactly what a stale `src/flows/generated.ts` after adding a unit
      // (and forgetting to rerun `oke dev` / `oke build`) looks like.
      await makeUnitDir(root, "notes");
      const mainFlow = flow("main.health", {
        effects: {},
        do: () => ({ ok: true as const }),
      });
      on(http.get("/health").gate.public, mainFlow);
      const app = oke({ name: "stale-barrel", gate: { unguardedHttp: "allow" } });

      await expect(
        app.boot({
          env: "dev",
          docker: true,
          rootDir: root,
          unguardedHttp: "allow",
          startScheduler: false,
          config: {
            drivers: {
              store: {
                sql: { dev: "memory" },
                kv: { dev: "memory" },
              },
              channel: { email: { dev: "console" } },
            },
          },
        }),
      ).rejects.toThrow(/OKE1009/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
