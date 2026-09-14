/**
 * Tests for Keel’s `node_modules/okengine` link (POSIX symlink / Windows junction).
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  linkOkengine,
  okengineLinkTarget,
  okengineLinkType,
  OKEENGINE_RELATIVE_LINK,
  removeOkengineLink,
  sameResolvedPath,
} from "./link-okengine.ts";

function fakeRepo(): { readonly repo: string; readonly keel: string } {
  const repo = mkdtempSync(join(tmpdir(), "oke-keel-link-"));
  const keel = join(repo, "examples/keel");
  mkdirSync(keel, { recursive: true });
  writeFileSync(join(repo, "package.json"), '{"name":"okengine"}\n');
  return { repo, keel };
}

describe("okengine link helpers", () => {
  test("Windows uses a junction to the absolute repo root", () => {
    expect(okengineLinkType("win32")).toBe("junction");
    expect(okengineLinkTarget("/repo", "win32")).toBe("/repo");
    expect(okengineLinkType("darwin")).toBeUndefined();
    expect(okengineLinkTarget("/repo", "darwin")).toBe(OKEENGINE_RELATIVE_LINK);
  });

  test("sameResolvedPath ignores drive-letter case on Windows", () => {
    expect(sameResolvedPath("D:\\oke\\okengine", "d:/oke/okengine", "win32")).toBe(true);
    expect(sameResolvedPath("/a", "/b", "darwin")).toBe(false);
  });
});

describe("linkOkengine", () => {
  test("creates a symlink whose realpath is the repo root", () => {
    const { repo, keel } = fakeRepo();
    try {
      linkOkengine(keel);
      const linked = join(keel, "node_modules/okengine");
      expect(realpathSync(linked)).toBe(realpathSync(repo));
      linkOkengine(keel);
      expect(realpathSync(linked)).toBe(realpathSync(repo));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("Windows path calls symlink with junction + absolute target", () => {
    const { repo, keel } = fakeRepo();
    const calls: Array<{ target: string; path: string; type?: string }> = [];
    try {
      linkOkengine(keel, {
        platform: "win32",
        symlink: ((target, path, type) => {
          calls.push({
            target: String(target),
            path: String(path),
            ...(type !== undefined ? { type: String(type) } : {}),
          });
        }) as typeof import("node:fs").symlinkSync,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.type).toBe("junction");
      expect(calls[0]?.target).toBe(realpathSync(repo));
      expect(calls[0]?.path).toBe(join(keel, "node_modules/okengine"));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("removeOkengineLink unlinks without deleting the repo", () => {
    const { repo, keel } = fakeRepo();
    try {
      linkOkengine(keel);
      removeOkengineLink(join(keel, "node_modules/okengine"));
      expect(readFileSync(join(repo, "package.json"), "utf8")).toContain("okengine");
      expect(() => realpathSync(join(keel, "node_modules/okengine"))).toThrow();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
