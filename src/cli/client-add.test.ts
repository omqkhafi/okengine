/**
 * `oke client add` — ambient .d.ts for separate-repo clients.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clientAdd,
  emitAmbient,
} from "./client-add.ts";
import type { ClientDescriptor } from "../client/types.ts";

const fixture: ClientDescriptor = {
  routes: {
    bookings: {
      create: {
        in: "{ flightId: string; seats: number }",
        out: "{ id: string; flightId: string; seats: number }",
        errors: {
          FlightFull: "{ seatsLeft: number }",
        },
        method: "POST",
        path: "/bookings",
      },
    },
  },
};

describe("oke client add", () => {
  test("emitAmbient produces a module augmentation", () => {
    const src = emitAmbient(fixture);
    expect(src).toContain('declare module "okengine/client"');
    expect(src).toContain("interface Register");
    expect(src).toContain("FlightFull");
    expect(src).toContain("{ seatsLeft: number }");
    expect(src).toContain("export {}");
  });

  test("writes a compiling .d.ts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-client-add-"));
    const out = join(dir, "oke-client.d.ts");

    const result = await clientAdd({ descriptor: fixture, out });
    expect(result.out).toBe(out);
    expect(result.source).toContain("FlightFull");

    // Ambient-only project — proves the .d.ts itself is valid TypeScript.
    const smoke = join(dir, "smoke.ts");
    await Bun.write(
      smoke,
      `
/// <reference path="./oke-client.d.ts" />
import type { Register } from "okengine/client";

type App = Register extends { app: infer A } ? A : never;
type Routes = App extends { $routes: infer R } ? R : never;
type Create = Routes extends {
  bookings: { create: infer C };
}
  ? C
  : never;
type ErrMap = Create extends { errors: infer E } ? E : never;
type Flight = ErrMap extends { FlightFull: infer D } ? D : never;

const seats: Flight extends { seatsLeft: infer N } ? N : never = 2;
void seats;
`,
    );

    // Minimal stub so `import type { Register }` resolves.
    const stubDir = join(dir, "node_modules/okengine");
    await Bun.$`mkdir -p ${stubDir}`.quiet();
    await Bun.write(
      join(stubDir, "client.d.ts"),
      `export interface Register {}\n`,
    );
    await Bun.write(
      join(stubDir, "package.json"),
      JSON.stringify({
        name: "okengine",
        types: "client.d.ts",
        exports: { "./client": { types: "./client.d.ts" } },
      }),
    );

    const tsconfig = join(dir, "tsconfig.json");
    await Bun.write(
      tsconfig,
      JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "ESNext",
          moduleResolution: "bundler",
          target: "ESNext",
          lib: ["ESNext"],
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["smoke.ts", "oke-client.d.ts"],
      }),
    );

    const proc = Bun.spawn(
      ["bunx", "tsc", "--project", tsconfig],
      { cwd: dir, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (code !== 0) {
      throw new Error(
        `tsc failed (${code})\n${stdout}\n${stderr}\n--- d.ts ---\n${result.source}`,
      );
    }
  });

  test("fetches /_oke/client.json from url", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-client-add-"));
    const out = join(dir, "from-url.d.ts");
    let hit = "";

    await clientAdd({
      url: "http://skyport.test",
      out,
      fetch: async (input) => {
        hit = String(input);
        return Response.json(fixture);
      },
    });

    expect(hit).toBe("http://skyport.test/_oke/client.json");
    const text = await Bun.file(out).text();
    expect(text).toContain("bookings");
  });
});
