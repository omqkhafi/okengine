import { describe, expect, test } from "bun:test";
import { base64ToBytes, bytesToBase64, decodeFileBody, utf8ToBase64 } from "./files-body.ts";

describe("files-body", () => {
  test("bytes round-trip through base64", () => {
    const bytes = new Uint8Array([0, 1, 255, 10]);
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([0, 1, 255, 10]);
  });

  test("utf8 encoding matches TextEncoder", () => {
    const text = "hello вложения";
    const decoded = decodeFileBody("utf8", text);
    expect(new TextDecoder().decode(decoded)).toBe(text);
    expect([...decodeFileBody("base64", utf8ToBase64(text))]).toEqual([...decoded]);
  });
});
