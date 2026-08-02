/**
 * OKE docker stack discovery / selection helpers.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  composeProjectName,
  downStack,
  isOkeDevProject,
  isOkeProjectRoot,
  listOkeComposeProjects,
  parseJsonRecords,
  projectFromResourceName,
  projectsFromContainerSelection,
  resolveSelection,
  selectionKey,
  type DockerRunner,
  type OkeContainer,
} from "./cleanup.ts";
import { stackAppSlug } from "./stack-id.ts";

describe("oke docker cleanup helpers", () => {
  test("composeProjectName matches oke-${stackAppSlug}", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-clean-id-"));
    expect(composeProjectName(dir)).toBe(`oke-${stackAppSlug(dir)}`);
    expect(isOkeDevProject(composeProjectName(dir))).toBe(true);
  });

  test("isOkeDevProject accepts only oke-dev-<6hex>", () => {
    expect(isOkeDevProject("oke-dev-a3f791")).toBe(true);
    expect(isOkeDevProject("oke-app")).toBe(false);
    expect(isOkeDevProject("oke-dev-ABCDEF")).toBe(false);
    expect(isOkeDevProject("other-dev-a3f791")).toBe(false);
  });

  test("projectFromResourceName strips volume/network suffixes", () => {
    expect(projectFromResourceName("oke-dev-a3f791_oke")).toBe("oke-dev-a3f791");
    expect(projectFromResourceName("oke-dev-a3f791_store-sql-data")).toBe("oke-dev-a3f791");
    expect(projectFromResourceName("oke-dev-a3f791")).toBe("oke-dev-a3f791");
    expect(projectFromResourceName("bridge")).toBeNull();
  });

  test("isOkeProjectRoot detects oke.config.ts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-clean-root-"));
    expect(await isOkeProjectRoot(dir)).toBe(false);
    await Bun.write(join(dir, "oke.config.ts"), "export default {};\n");
    expect(await isOkeProjectRoot(dir)).toBe(true);
  });

  test("parseJsonRecords handles array and NDJSON", () => {
    expect(parseJsonRecords('[{"Name":"a"},{"Name":"b"}]')).toEqual([{ Name: "a" }, { Name: "b" }]);
    expect(parseJsonRecords('{"Name":"a"}\n{"Name":"b"}\n')).toEqual([
      { Name: "a" },
      { Name: "b" },
    ]);
    expect(parseJsonRecords("")).toEqual([]);
  });

  test("projectsFromContainerSelection dedupes", () => {
    const containers: OkeContainer[] = [
      {
        id: "1",
        name: "oke-dev-a3f791-store-sql-1",
        service: "store-sql",
        state: "running",
        project: "oke-dev-a3f791",
      },
      {
        id: "2",
        name: "oke-dev-a3f791-store-kv-1",
        service: "store-kv",
        state: "exited",
        project: "oke-dev-a3f791",
      },
      {
        id: "3",
        name: "oke-dev-b0b0b0-store-sql-1",
        service: "store-sql",
        state: "running",
        project: "oke-dev-b0b0b0",
      },
    ];
    expect(projectsFromContainerSelection(containers)).toEqual([
      "oke-dev-a3f791",
      "oke-dev-b0b0b0",
    ]);
  });

  test("resolveSelection maps keys to projects", () => {
    const stacks = [
      {
        project: "oke-dev-a3f791",
        containers: [
          {
            id: "1",
            name: "c1",
            service: "store-sql",
            state: "running",
            project: "oke-dev-a3f791",
          },
        ],
      },
      { project: "oke-dev-b0b0b0", containers: [] },
    ];
    const { projects, containers } = resolveSelection(
      [selectionKey("oke-dev-a3f791", "c1"), selectionKey("oke-dev-b0b0b0")],
      stacks,
    );
    expect(projects).toEqual(["oke-dev-a3f791", "oke-dev-b0b0b0"]);
    expect(containers).toHaveLength(1);
    expect(containers[0]!.name).toBe("c1");
  });

  test("listOkeComposeProjects merges compose ls + containers + volumes", async () => {
    const run: DockerRunner = async (args) => {
      const key = args.join(" ");
      if (key.startsWith("compose ls")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ Name: "oke-dev-aaaaaa", Status: "exited(1)" }]),
          stderr: "",
        };
      }
      if (key.includes("label=com.docker.compose.project=") && key.startsWith("ps")) {
        const filter = args[args.indexOf("--filter")! + 1]!;
        const project = filter.replace(/^label=com\.docker\.compose\.project=/, "");
        if (project === "oke-dev-bbbbbb") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              ID: "x",
              Names: "oke-dev-bbbbbb-store-sql-1",
              State: "exited",
              Labels:
                "com.docker.compose.project=oke-dev-bbbbbb,com.docker.compose.service=store-sql",
            }),
            stderr: "",
          };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (key.startsWith("ps -a --filter label=com.docker.compose.project --format")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            ID: "x",
            Names: "oke-dev-bbbbbb-store-sql-1",
            State: "exited",
            Labels:
              "com.docker.compose.project=oke-dev-bbbbbb,com.docker.compose.service=store-sql",
          }),
          stderr: "",
        };
      }
      if (key.startsWith("volume ls")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ Name: "oke-dev-cccccc_store-files-data" }),
          stderr: "",
        };
      }
      if (key.startsWith("network ls")) {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: `unexpected: ${key}` };
    };

    const stacks = await listOkeComposeProjects(run);
    expect(stacks.map((s) => s.project)).toEqual([
      "oke-dev-aaaaaa",
      "oke-dev-bbbbbb",
      "oke-dev-cccccc",
    ]);
    expect(stacks.find((s) => s.project === "oke-dev-bbbbbb")!.containers).toHaveLength(1);
    expect(stacks.find((s) => s.project === "oke-dev-cccccc")!.containers).toHaveLength(0);
  });

  test("downStack refuses non-OKE names and runs down -v", async () => {
    await expect(
      downStack("evil", async () => ({ exitCode: 0, stdout: "", stderr: "" })),
    ).rejects.toThrow(/refusing/);

    const calls: string[][] = [];
    await downStack("oke-dev-a3f791", async (args) => {
      calls.push([...args]);
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    expect(calls).toEqual([["compose", "-p", "oke-dev-a3f791", "down", "-v", "--remove-orphans"]]);
  });
});
