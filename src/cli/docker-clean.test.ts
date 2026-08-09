/**
 * `oke docker clean` — non-interactive flag matrix + wiring.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeProjectName, type DockerRunner } from "../docker/cleanup.ts";
import { dockerCli } from "./docker.ts";
import {
  dockerCleanHelp,
  parseDockerCleanArgs,
  runDockerClean,
  selectionEntries,
} from "./docker-clean.ts";
import { EXIT_OK, EXIT_USAGE } from "./exit.ts";
import { formatOkeHelp, flagTokensFor, OKE_COMMANDS } from "./registry.ts";

function fakeStacksRunner(projects: readonly string[]): DockerRunner {
  return async (args) => {
    const key = args.join(" ");
    if (key.startsWith("compose ls")) {
      return {
        exitCode: 0,
        stdout: JSON.stringify(projects.map((Name) => ({ Name, Status: "exited" }))),
        stderr: "",
      };
    }
    if (key.includes("label=com.docker.compose.project=") && key.startsWith("ps")) {
      const filter = args[args.indexOf("--filter")! + 1]!;
      const project = filter.replace(/^label=com\.docker\.compose\.project=/, "");
      if (!projects.includes(project)) return { exitCode: 0, stdout: "", stderr: "" };
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          ID: "id",
          Names: `${project}-store-sql-1`,
          State: "exited",
          Labels: `com.docker.compose.project=${project},com.docker.compose.service=store-sql`,
        }),
        stderr: "",
      };
    }
    if (key.startsWith("ps -a --filter label=com.docker.compose.project --format")) {
      return {
        exitCode: 0,
        stdout: projects
          .map((project) =>
            JSON.stringify({
              ID: "id",
              Names: `${project}-store-sql-1`,
              State: "exited",
              Labels: `com.docker.compose.project=${project},com.docker.compose.service=store-sql`,
            }),
          )
          .join("\n"),
        stderr: "",
      };
    }
    if (key.startsWith("volume ls") || key.startsWith("network ls")) {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (key.startsWith("compose -p ") && key.includes("down")) {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    return { exitCode: 1, stdout: "", stderr: `unexpected: ${key}` };
  };
}

describe("oke docker clean", () => {
  test("parseDockerCleanArgs", () => {
    expect(parseDockerCleanArgs(["--yes", "--all"])).toEqual({ yes: true, all: true });
    expect(parseDockerCleanArgs(["-y"])).toEqual({ yes: true, all: false });
    expect(parseDockerCleanArgs(["--help"]).help).toBe(true);
    expect(() => parseDockerCleanArgs(["--nope"])).toThrow(/unknown flag/);
  });

  test("non-TTY outside without --all --yes → usage", async () => {
    const err: string[] = [];
    const code = await runDockerClean({
      cwd: await mkdtemp(join(tmpdir(), "oke-clean-out-")),
      stdinIsTTY: false,
      yes: true,
      all: false,
      runDocker: fakeStacksRunner(["oke-dev-aaaaaa"]),
      writeErr: (t) => err.push(t),
    });
    expect(code).toBe(EXIT_USAGE);
    expect(err.join("")).toContain("--all --yes");
  });

  test("non-TTY outside --all --yes tears down every stack", async () => {
    const downs: string[] = [];
    const run: DockerRunner = async (args) => {
      if (args[0] === "compose" && args[1] === "-p" && args.includes("down")) {
        downs.push(args[2]!);
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      return fakeStacksRunner(["oke-dev-aaaaaa", "oke-dev-bbbbbb"])(args);
    };
    const logs: string[] = [];
    const code = await runDockerClean({
      cwd: await mkdtemp(join(tmpdir(), "oke-clean-all-")),
      stdinIsTTY: false,
      yes: true,
      all: true,
      runDocker: run,
      write: (t) => logs.push(t),
    });
    expect(code).toBe(EXIT_OK);
    expect(downs.sort()).toEqual(["oke-dev-aaaaaa", "oke-dev-bbbbbb"]);
    expect(logs.join("")).toContain("down -v");
  });

  test("non-TTY inside --yes cleans current project only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-clean-in-"));
    await Bun.write(join(dir, "oke.config.ts"), "export default {};\n");
    const current = composeProjectName(dir);
    const other = "oke-dev-ffffff";
    const downs: string[] = [];
    const run: DockerRunner = async (args) => {
      if (args[0] === "compose" && args[1] === "-p" && args.includes("down")) {
        downs.push(args[2]!);
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      return fakeStacksRunner([current, other])(args);
    };
    const code = await runDockerClean({
      cwd: dir,
      stdinIsTTY: false,
      yes: true,
      runDocker: run,
      write: () => {},
    });
    expect(code).toBe(EXIT_OK);
    expect(downs).toEqual([current]);
  });

  test("non-TTY without --yes → usage", async () => {
    const code = await runDockerClean({
      cwd: await mkdtemp(join(tmpdir(), "oke-clean-noy-")),
      stdinIsTTY: false,
      runDocker: fakeStacksRunner(["oke-dev-aaaaaa"]),
      writeErr: () => {},
    });
    expect(code).toBe(EXIT_USAGE);
  });

  test("TTY empty selection exits 0", async () => {
    const code = await runDockerClean({
      cwd: await mkdtemp(join(tmpdir(), "oke-clean-empty-")),
      stdinIsTTY: true,
      runDocker: fakeStacksRunner(["oke-dev-aaaaaa"]),
      pickKeys: async () => [],
      write: () => {},
    });
    expect(code).toBe(EXIT_OK);
  });

  test("TTY cancel exits 0", async () => {
    const code = await runDockerClean({
      cwd: await mkdtemp(join(tmpdir(), "oke-clean-cancel-")),
      stdinIsTTY: true,
      runDocker: fakeStacksRunner(["oke-dev-aaaaaa"]),
      pickKeys: async () => null,
      write: () => {},
    });
    expect(code).toBe(EXIT_OK);
  });

  test("dockerCli routes clean subcommand", async () => {
    const code = await dockerCli(["clean", "--help"]);
    expect(code).toBe(EXIT_OK);
    expect(dockerCleanHelp()).toContain("--all");
  });

  test("registry lists clean flags and help mentions clean", () => {
    const docker = OKE_COMMANDS.find((c) => c.name === "docker")!;
    expect(flagTokensFor(docker, "clean")).toContain("--yes");
    expect(flagTokensFor(docker, "clean")).toContain("--all");
    expect(formatOkeHelp()).toContain("clean");
  });

  test("selectionEntries is one row per project (not per container)", () => {
    const entries = selectionEntries([
      {
        project: "oke-dev-aaaaaa",
        containers: [
          {
            id: "1",
            name: "oke-dev-aaaaaa-redis-1",
            service: "redis",
            state: "running",
            project: "oke-dev-aaaaaa",
          },
          {
            id: "2",
            name: "oke-dev-aaaaaa-postgres-1",
            service: "postgres",
            state: "running",
            project: "oke-dev-aaaaaa",
          },
        ],
      },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.label).toBe("oke-dev-aaaaaa");
    expect(entries[0]?.hint).toContain("2 container");
  });
});
