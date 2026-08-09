/**
 * Unit tests for hidden / stdin master-key helpers.
 */

import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { promptHidden, readStdinSecure } from "./vault-secure-input.ts";

describe("readStdinSecure", () => {
  test("trims a full stdin payload", async () => {
    const stdin = new EventEmitter() as EventEmitter & {
      setEncoding?: (encoding: BufferEncoding) => void;
    };
    stdin.setEncoding = () => undefined;
    const pending = readStdinSecure(stdin);
    stdin.emit("data", "  abc123\n");
    stdin.emit("end");
    expect(await pending).toBe("abc123");
  });
});

describe("promptHidden", () => {
  test("masks characters and resolves on Enter", async () => {
    const stdin = new EventEmitter() as EventEmitter & {
      setRawMode?: (mode: boolean) => void;
      off?: (event: string, listener: (...args: unknown[]) => void) => void;
    };
    let raw = false;
    stdin.setRawMode = (mode) => {
      raw = mode;
    };
    stdin.off = (event: string | symbol, listener: (...args: unknown[]) => void) => {
      stdin.removeListener(event, listener);
      return stdin;
    };
    let written = "";
    const pending = promptHidden("key: ", {
      stdin,
      write: (t) => {
        written += t;
      },
      exit: () => {
        throw new Error("exit should not run");
      },
    });
    // Allow the listener to attach.
    await Promise.resolve();
    stdin.emit("data", "ab");
    stdin.emit("data", "\r");
    expect(await pending).toBe("ab");
    expect(written).toContain("key: ");
    expect(written).toContain("**");
    expect(written).not.toContain("ab");
    expect(raw).toBe(false);
  });
});
