import { describe, expect, test } from "bun:test";

import { assembleInput, HttpBodyRejected, parseBody } from "./http-parse.ts";

function request(body: string, contentType?: string, length?: string): Request {
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  if (length) headers.set("content-length", length);
  return new Request("http://localhost/hooks", { method: "POST", body, headers });
}

describe("request bodies", () => {
  test("rejects an overstated and an honest body over the cap", async () => {
    await expect(
      parseBody(request("{}", "application/json", "99"), { maxBytes: 4 }),
    ).rejects.toBeInstanceOf(HttpBodyRejected);
    await expect(
      parseBody(request("{}", "application/json"), { maxBytes: 1 }),
    ).rejects.toMatchObject({
      code: "PayloadTooLarge",
    });
  });

  test("sendBeacon text/plain JSON is 415 unless the route opts out", async () => {
    const beacon = request('{"n":1}', "text/plain;charset=UTF-8");
    await expect(parseBody(beacon)).rejects.toMatchObject({ code: "UnsupportedMediaType" });
    await expect(
      parseBody(request('{"n":1}', "text/plain"), { jsonContentType: "any" }),
    ).resolves.toEqual({
      n: 1,
    });
  });

  test("a form body that parses as JSON is 415, and a normal form body stays a string", async () => {
    await expect(
      parseBody(request("{not json", "application/x-www-form-urlencoded")),
    ).resolves.toBe("{not json");
    await expect(
      parseBody(request('{"a":1}', "application/x-www-form-urlencoded")),
    ).rejects.toMatchObject({ code: "UnsupportedMediaType" });
    await expect(parseBody(request("a=1&b=2", "application/x-www-form-urlencoded"))).resolves.toBe(
      "a=1&b=2",
    );
  });

  test("application/json must parse, and +json is accepted", async () => {
    await expect(parseBody(request("{", "application/json"))).rejects.toMatchObject({
      code: "InvalidQuery",
      reason: "malformed_body",
    });
    await expect(
      parseBody(request('{"n":1}', "application/vnd.x+json; charset=utf-8")),
    ).resolves.toEqual({ n: 1 });
  });

  test("drops __proto__ and keeps a constructor field", async () => {
    const parsed = await parseBody(
      request('{"__proto__":{"isAdmin":true},"constructor":"ok"}', "application/json"),
    );
    expect((parsed as { isAdmin?: boolean; constructor?: string }).isAdmin).toBeUndefined();
    expect((parsed as { constructor?: string }).constructor).toBe("ok");
    expect(Object.prototype).not.toHaveProperty("isAdmin");
    const input = assembleInput({ body: parsed });
    expect((input as { isAdmin?: boolean }).isAdmin).toBeUndefined();
  });

  test("an empty body is undefined", async () => {
    await expect(
      parseBody(new Request("http://localhost/", { method: "DELETE" })),
    ).resolves.toBeUndefined();
  });
});
