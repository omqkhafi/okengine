/**
 * File-tree path stamps — POSIX normalize is a requirement, not an assumption.
 */

import { describe, expect, test } from "bun:test";
import {
  importSpecifierFromWalked,
  nameFromFlowFile,
  pathFromFlowFile,
  toPosixPath,
  unitFromFlowFile,
} from "./flow-path.ts";

describe("toPosixPath / importSpecifierFromWalked", () => {
  test("normalizes Windows backslashes to /", () => {
    expect(toPosixPath("notes\\[id]\\get.ts")).toBe("notes/[id]/get.ts");
  });

  test("emits a POSIX import specifier even when the walked path used \\", () => {
    const spec = importSpecifierFromWalked("notes\\[id]\\get.ts");
    expect(spec).toBe("./notes/[id]/get.ts");
    expect(spec.includes("\\")).toBe(false);
  });

  test("catch-all walked with \\ becomes a quoted-ready POSIX specifier", () => {
    expect(importSpecifierFromWalked("docs\\[...slug]\\get.ts")).toBe("./docs/[...slug]/get.ts");
  });
});

describe("pathFromFlowFile", () => {
  test("[id] → :id on a reserved get leaf", () => {
    expect(pathFromFlowFile("notes/[id]/get.ts")).toBe("/notes/:id");
  });

  test("[...slug] → *", () => {
    expect(pathFromFlowFile("docs/[...slug]/get.ts")).toBe("/docs/*");
  });

  test("(group) is omitted from the URL", () => {
    expect(pathFromFlowFile("notes/(ops)/archive.ts")).toBe("/notes/archive");
  });

  test("reserved leaves do not add a segment", () => {
    expect(pathFromFlowFile("notes/list.ts")).toBe("/notes");
    expect(pathFromFlowFile("notes/create.ts")).toBe("/notes");
    expect(pathFromFlowFile("notes/route.ts")).toBe("/notes");
    expect(pathFromFlowFile("notes/[id]/update.ts")).toBe("/notes/:id");
    expect(pathFromFlowFile("notes/[id]/remove.ts")).toBe("/notes/:id");
  });

  test("action leaves add a segment", () => {
    expect(pathFromFlowFile("notes/[id]/archive.ts")).toBe("/notes/:id/archive");
    expect(pathFromFlowFile("notes/query.ts")).toBe("/notes/query");
  });

  test("main omits the URL prefix — health.ts is /health, index/route is /", () => {
    expect(pathFromFlowFile("main/health.ts")).toBe("/health");
    expect(pathFromFlowFile("main/index.ts")).toBe("/");
    expect(pathFromFlowFile("main/route.ts")).toBe("/");
  });

  test("skip-list files return undefined", () => {
    expect(pathFromFlowFile("notes/shapes.ts")).toBeUndefined();
    expect(pathFromFlowFile("notes/signals.ts")).toBeUndefined();
    expect(pathFromFlowFile("notes/list.test.ts")).toBeUndefined();
    expect(pathFromFlowFile("notes/_lib/util.ts")).toBeUndefined();
    expect(pathFromFlowFile("src/flows/generated.ts")).toBeUndefined();
  });

  test("accepts a source path under src/flows/", () => {
    expect(pathFromFlowFile("src/flows/notes/[id]/get.ts")).toBe("/notes/:id");
  });

  test("Windows-shaped string yields the same URL as POSIX (requirement)", () => {
    expect(pathFromFlowFile("notes\\[id]\\get.ts")).toBe("/notes/:id");
    expect(pathFromFlowFile("notes\\[...slug]\\get.ts")).toBe("/notes/*");
    expect(pathFromFlowFile("src\\flows\\notes\\[id]\\get.ts")).toBe("/notes/:id");
  });

  test("[[...slug]] optional catch-all is not inferred", () => {
    expect(pathFromFlowFile("docs/[[...slug]]/get.ts")).toBeUndefined();
  });
});

describe("nameFromFlowFile / unitFromFlowFile", () => {
  test("unit + export — [id] is not part of the name", () => {
    expect(unitFromFlowFile("src/flows/notes/[id]/get.ts")).toBe("notes");
    expect(nameFromFlowFile("src/flows/notes/[id]/get.ts", "get")).toBe("notes.get");
    expect(nameFromFlowFile("notes/[id]/archive.ts", "archive")).toBe("notes.archive");
  });

  test("main unit keeps the main. prefix on the Flow name", () => {
    expect(nameFromFlowFile("main/health.ts", "health")).toBe("main.health");
    expect(nameFromFlowFile("main/route.ts", "root")).toBe("main.root");
  });
});
