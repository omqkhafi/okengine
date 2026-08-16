import { describe, expect, test } from "bun:test";
import { isConsoleKernelPath, isConsoleSpaPath } from "./serve.ts";

describe("isConsoleSpaPath", () => {
  test("keeps the Console pages", () => {
    expect(isConsoleSpaPath("/")).toBe(true);
    expect(isConsoleSpaPath("/overview")).toBe(true);
    expect(isConsoleSpaPath("/flows")).toBe(true);
    expect(isConsoleSpaPath("/store")).toBe(true);
    expect(isConsoleSpaPath("/vault")).toBe(true);
    expect(isConsoleSpaPath("/observability")).toBe(true);
    expect(isConsoleSpaPath("/monitoring")).toBe(true);
  });

  test("unknown paths are not SPA pages", () => {
    expect(isConsoleSpaPath("/units")).toBe(false);
    expect(isConsoleSpaPath("/dashboard")).toBe(false);
    expect(isConsoleSpaPath("/overview/")).toBe(false);
  });
});

describe("isConsoleKernelPath", () => {
  test("keeps API, live, ingest, and plugin frames on the kernel", () => {
    expect(isConsoleKernelPath("/console/setup/status")).toBe(true);
    expect(isConsoleKernelPath("/console/live")).toBe(true);
    expect(isConsoleKernelPath("/console/runs/ingest")).toBe(true);
    expect(isConsoleKernelPath("/plugin-frame/demo")).toBe(true);
  });

  test("SPA and Vite module paths are not kernel-owned", () => {
    expect(isConsoleKernelPath("/")).toBe(false);
    expect(isConsoleKernelPath("/overview")).toBe(false);
    expect(isConsoleKernelPath("/@vite/client")).toBe(false);
    expect(isConsoleKernelPath("/src/main.tsx")).toBe(false);
  });
});
