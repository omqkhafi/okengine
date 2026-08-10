/**
 * `oke console claim-code` — reads `.oke/claim-code`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintClaimCode, writeClaimCodeArtifact } from "../console/server/claim.ts";
import { consoleClaimCode } from "./console-cmd.ts";
import { EXIT_OK, EXIT_RUNTIME } from "./exit.ts";

describe("oke console claim-code", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  test("prints the mirrored code", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "oke-cli-claim-"));
    dirs.push(cwd);
    let t = 2_000_000;
    const state = mintClaimCode(() => t);
    writeClaimCodeArtifact(cwd, state);
    const out: string[] = [];
    const err: string[] = [];
    const code = await consoleClaimCode({
      cwd,
      now: () => t,
      write: (s) => out.push(s),
      writeErr: (s) => err.push(s),
    });
    expect(code).toBe(EXIT_OK);
    expect(out.join("").trim()).toBe(state.code);
    expect(err.join("")).toContain("expires in");
  });

  test("json includes remainingMs", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "oke-cli-claim-"));
    dirs.push(cwd);
    let t = 2_000_000;
    const state = mintClaimCode(() => t);
    writeClaimCodeArtifact(cwd, state);
    const out: string[] = [];
    const code = await consoleClaimCode({
      cwd,
      now: () => t,
      json: true,
      write: (s) => out.push(s),
      writeErr: () => {},
    });
    expect(code).toBe(EXIT_OK);
    const body = JSON.parse(out.join("")) as {
      ok: boolean;
      code: string;
      remainingMs: number;
    };
    expect(body.ok).toBe(true);
    expect(body.code).toBe(state.code);
    expect(body.remainingMs).toBe(state.expiresAt - t);
  });

  test("missing mirror exits runtime", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "oke-cli-claim-"));
    dirs.push(cwd);
    const err: string[] = [];
    const code = await consoleClaimCode({
      cwd,
      write: () => {},
      writeErr: (s) => err.push(s),
    });
    expect(code).toBe(EXIT_RUNTIME);
    expect(err.join("")).toContain("No claim code");
  });
});
