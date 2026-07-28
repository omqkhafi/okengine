/**
 * Driver map resolution — including `docker` → prod fallback.
 * ConfigEnv inference for boot (`resolveConfigEnv`).
 */

import { describe, expect, test } from "bun:test";
import { resolveConfigEnv, resolveDriverId } from "./index.ts";

describe("resolveConfigEnv", () => {
  test("docker mode wins over explicit env and NODE_ENV", () => {
    expect(
      resolveConfigEnv({
        env: "test",
        docker: true,
        nodeEnv: "production",
      }),
    ).toBe("docker");
    expect(
      resolveConfigEnv({
        env: "prod",
        okeDocker: "1",
        nodeEnv: "development",
      }),
    ).toBe("docker");
  });

  test("explicit env wins when not docker", () => {
    expect(
      resolveConfigEnv({ env: "prod", nodeEnv: "development" }),
    ).toBe("prod");
    expect(resolveConfigEnv({ env: "test", nodeEnv: "production" })).toBe(
      "test",
    );
  });

  test("infers prod / test / local from NODE_ENV", () => {
    expect(resolveConfigEnv({ nodeEnv: "production", okeDocker: "" })).toBe(
      "prod",
    );
    expect(resolveConfigEnv({ nodeEnv: "test", okeDocker: "" })).toBe("test");
    expect(resolveConfigEnv({ nodeEnv: "development", okeDocker: "" })).toBe(
      "local",
    );
    // Empty string = explicit non-match (do not fall through to process.env).
    expect(resolveConfigEnv({ nodeEnv: "", okeDocker: "" })).toBe("local");
  });

  test("docker: false ignores OKE_DOCKER", () => {
    expect(
      resolveConfigEnv({
        docker: false,
        okeDocker: "1",
        nodeEnv: "production",
      }),
    ).toBe("prod");
  });
});

describe("resolveDriverId", () => {
  test("reads the named env key", () => {
    expect(
      resolveDriverId({ local: "sqlite", prod: "postgres" }, "local"),
    ).toBe("sqlite");
    expect(
      resolveDriverId({ local: "sqlite", prod: "postgres" }, "prod"),
    ).toBe("postgres");
  });

  test("docker prefers docker, then prod, then local", () => {
    expect(
      resolveDriverId(
        { local: "sqlite", docker: "postgres", prod: "postgres" },
        "docker",
      ),
    ).toBe("postgres");
    expect(
      resolveDriverId({ local: "sqlite", prod: "postgres" }, "docker"),
    ).toBe("postgres");
    expect(resolveDriverId({ local: "sqlite" }, "docker")).toBe("sqlite");
  });

  test("accepts legacy dev/stack keys", () => {
    expect(
      resolveDriverId(
        { dev: "sqlite", stack: "postgres", prod: "postgres" } as never,
        "docker",
      ),
    ).toBe("postgres");
    expect(
      resolveDriverId({ dev: "sqlite", prod: "postgres" } as never, "local"),
    ).toBe("sqlite");
  });
});
