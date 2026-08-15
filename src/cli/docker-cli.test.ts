/**
 * `oke docker` / `oke stack` / `oke images pin` / `oke schema` / `oke dev --docker`.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDev } from "./dev.ts";
import { runDockerDerive } from "./docker.ts";
import { runImagesPin } from "./images.ts";
import { emitSchemaSource, runSchemaGenerate } from "./schema.ts";
import { runStackPreview } from "./stack.ts";
import { runStart, resolveStartEntry } from "./start.ts";
import { vaultCli } from "./vault-cmd.ts";

const images = {
  "store.sql": "pgvector/pgvector:pg17",
} as const;

const credentials = {
  "store.sql": {
    user: "oke",
    password: "test-password-not-in-yaml",
    database: "oke",
  },
} as const;

describe("oke docker CLI", () => {
  test("writes Dockerfile and compose under docker/ by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-cli-docker-"));
    const logs: string[] = [];
    const { code, result } = await runDockerDerive({
      cwd: dir,
      images,
      credentials,
      write: (t) => logs.push(t),
    });
    expect(code).toBe(0);
    expect(result).toBeDefined();
    expect(await Bun.file(join(dir, "docker/Dockerfile")).exists()).toBe(true);
    expect(await Bun.file(join(dir, "docker/docker-compose.yml")).exists()).toBe(true);
    const yml = await Bun.file(join(dir, "docker/docker-compose.yml")).text();
    expect(yml).not.toContain("test-password-not-in-yaml");
    expect(yml).toContain(".env.local");
    expect(yml).toContain("/_/ready");
    expect(logs.join("")).toContain("docker-compose.override.yml");
  });
});

describe("oke stack", () => {
  test("previews without writing files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-cli-stack-"));
    let out = "";
    const code = await runStackPreview({
      cwd: dir,
      images,
      write: (t) => {
        out += t;
      },
    });
    expect(code).toBe(0);
    expect(out).toContain("store.sql");
    expect(out).toContain("postgres");
    expect(await Bun.file(join(dir, "compose.yml")).exists()).toBe(false);
  });

  test("uses per-project host ports (not raw recipe defaults)", async () => {
    const { stackInstanceId, hostPortForInstance } = await import("../docker/index.ts");
    const dir = await mkdtemp(join(tmpdir(), "oke-cli-stack-ports-"));
    let out = "";
    const code = await runStackPreview({
      cwd: dir,
      images: {
        "channel.email": "axllent/mailpit:v1.22.3",
      },
      write: (t) => {
        out += t;
      },
    });
    expect(code).toBe(0);
    const id = stackInstanceId(dir);
    const smtp = hostPortForInstance("channel.email", 1025, id);
    expect(out).toContain(`${smtp}:1025`);
    expect(out).not.toContain("1025:1025");
  });
});

describe("oke images pin", () => {
  test("writes oke.images.lock via injected resolver", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-cli-pin-"));
    const code = await runImagesPin({
      cwd: dir,
      images,
      resolveDigest: async () => "sha256:abc123",
      write: () => {},
    });
    expect(code).toBe(0);
    const lock = await Bun.file(join(dir, "oke.images.lock")).json();
    expect(lock.images["store.sql"].digest).toBe("sha256:abc123");
  });
});

describe("oke images list", () => {
  test("lists recipe/image/tag/digest/size without writing", async () => {
    const { runImagesList } = await import("./images.ts");
    const dir = await mkdtemp(join(tmpdir(), "oke-cli-images-list-"));
    let out = "";
    const code = await runImagesList({
      cwd: dir,
      images,
      lock: {
        oke: "1.0",
        images: {
          "store.sql": {
            image: "pgvector/pgvector:pg17@sha256:abc123",
            digest: "sha256:abc123",
            pinnedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      },
      write: (t) => {
        out += t;
      },
    });
    expect(code).toBe(0);
    expect(out).toContain("RECIPE");
    expect(out).toContain("DIGEST");
    expect(out).toContain("SIZE");
    expect(out).toContain("store.sql");
    expect(out).toContain("postgres");
    expect(out).toContain("pgvector/pgvector");
    expect(out).toContain("pg17");
    expect(out).toContain("sha256:abc123");
    expect(await Bun.file(join(dir, "oke.images.lock")).exists()).toBe(false);
  });
});

describe("oke schema generate", () => {
  test("emits .oke/schema/oke.ts and --check catches drift", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-cli-schema-"));
    const code = await runSchemaGenerate({
      cwd: dir,
      extraTables: ["bookings"],
      write: () => {},
    });
    expect(code).toBe(0);
    const src = await Bun.file(join(dir, ".oke/schema/oke.ts")).text();
    expect(src).toContain("bookings");
    expect(src).toContain("oke_roles");

    const checkOk = await runSchemaGenerate({
      cwd: dir,
      extraTables: ["bookings"],
      check: true,
      write: () => {},
    });
    expect(checkOk).toBe(0);

    await Bun.write(join(dir, ".oke/schema/oke.ts"), emitSchemaSource(["other"]));
    const checkFail = await runSchemaGenerate({
      cwd: dir,
      extraTables: ["bookings"],
      check: true,
      write: () => {},
    });
    expect(checkFail).toBe(1);
  });
});

describe("oke dev compose plan", () => {
  test("plans docker with postgres and writes nothing on dryRun", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-cli-dev-dry-"));
    await Bun.write(join(dir, "src/app.ts"), "export {}\n");
    const { code, plan } = await runDev({
      stdinIsTTY: false,
      cwd: dir,
      docker: ["store.sql"],
      images,
      credentials,
      dryRun: true,
      write: () => {},
    });
    expect(code).toBe(0);
    expect(plan?.stackRoles).toEqual(["store.sql"]);
    expect(plan?.composeFiles).toContain("docker-compose.yml");
    expect(plan?.composeFiles?.some((f) => f.includes("store.sql"))).toBe(false);
    expect(plan?.stackEnv?.DATABASE_URL).toContain("postgres://");
    expect(await Bun.file(join(dir, "docker-compose.yml")).exists()).toBe(false);
    expect(await Bun.file(join(dir, "docker/docker-compose.yml")).exists()).toBe(false);
  });
});

describe("oke start", () => {
  test("resolves entry and invokes runEntry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-cli-start-"));
    await Bun.write(join(dir, "src/app.ts"), "export {}\n");
    const entry = await resolveStartEntry(dir);
    expect(entry).toEndWith("src/app.ts");
    let ran = "";
    const code = await runStart({
      cwd: dir,
      runEntry: async (e) => {
        ran = e;
      },
      write: () => {},
    });
    expect(code).toBe(0);
    expect(ran).toBe(entry);
  });

  test("sets OKE_ROOT_DIR so boot() can lazily derive effects for undeclared flows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-cli-start-rootdir-"));
    await Bun.write(join(dir, "src/app.ts"), "export {}\n");
    let seenRootDir: string | undefined;
    const code = await runStart({
      cwd: dir,
      runEntry: async (_e, env) => {
        seenRootDir = env.OKE_ROOT_DIR;
      },
      write: () => {},
    });
    expect(code).toBe(0);
    expect(seenRootDir).toBe(dir);
  });
});

describe("oke vault", () => {
  test("set and list", async () => {
    const store = new Map<string, string>();
    const bag = {
      get: (n: string) => store.get(n),
      set: (n: string, v: string) => {
        store.set(n, v);
      },
      names: () => [...store.keys()],
    };
    let out = "";
    expect(
      await vaultCli(["set", "STRIPE_KEY", "sk_test"], {
        store: bag,
        write: (t) => {
          out += t;
        },
      }),
    ).toBe(0);
    out = "";
    expect(
      await vaultCli(["list"], {
        store: bag,
        write: (t) => {
          out += t;
        },
      }),
    ).toBe(0);
    expect(out).toContain("STRIPE_KEY");
  });
});
