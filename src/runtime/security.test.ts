import { describe, expect, test } from "bun:test";
import {
  checkRequestSecurity,
  isHostAllowed,
  normalizeHost,
  resolveAllowedHosts,
  secureFetch,
} from "./security.ts";

describe("normalizeHost", () => {
  test("strips port and lowercases", () => {
    expect(normalizeHost("LocalHost:6530")).toBe("localhost");
    expect(normalizeHost("APP.Example.COM")).toBe("app.example.com");
  });

  test("handles IPv6 bracket form", () => {
    expect(normalizeHost("[::1]:6530")).toBe("::1");
    expect(normalizeHost("[::1]")).toBe("::1");
  });
});

describe("resolveAllowedHosts", () => {
  test("always includes loopback and listen hostname", () => {
    const hosts = resolveAllowedHosts("0.0.0.0", ["app.example.com"]);
    expect(hosts.has("localhost")).toBe(true);
    expect(hosts.has("127.0.0.1")).toBe(true);
    expect(hosts.has("app.example.com")).toBe(true);
    expect(hosts.has("0.0.0.0")).toBe(false);
  });
});

describe("isHostAllowed", () => {
  test("exact and leading-dot suffix", () => {
    const allowed = new Set(["localhost", ".example.com"]);
    expect(isHostAllowed("localhost", allowed)).toBe(true);
    expect(isHostAllowed("a.example.com", allowed)).toBe(true);
    expect(isHostAllowed("example.com", allowed)).toBe(true);
    expect(isHostAllowed("attacker.com", allowed)).toBe(false);
  });
});

describe("checkRequestSecurity", () => {
  const allowed = resolveAllowedHosts("127.0.0.1", ["app.example.com"]);

  test("accepts allowed Host", () => {
    const req = new Request("http://127.0.0.1/ping", {
      headers: { host: "127.0.0.1:6530" },
    });
    expect(checkRequestSecurity(req, allowed)).toEqual({ ok: true });
  });

  test("rejects unexpected Host (DNS rebinding class)", () => {
    const req = new Request("http://attacker.com/ping", {
      headers: { host: "attacker.com" },
    });
    expect(checkRequestSecurity(req, allowed)).toEqual({
      ok: false,
      reason: "host",
    });
  });

  test("rejects missing Host", () => {
    // Request from constructor may synthesize Host from URL — force empty
    const bare = new Request("http://127.0.0.1/ping", {
      headers: { host: "" },
    });
    expect(checkRequestSecurity(bare, allowed).ok).toBe(false);
  });

  test("rejects unexpected Origin", () => {
    const req = new Request("http://127.0.0.1/ping", {
      headers: {
        host: "127.0.0.1",
        origin: "http://attacker.com",
      },
    });
    expect(checkRequestSecurity(req, allowed)).toEqual({
      ok: false,
      reason: "origin",
    });
  });

  test("accepts Origin on an allowed host", () => {
    const req = new Request("http://app.example.com/ping", {
      headers: {
        host: "app.example.com",
        origin: "https://app.example.com",
      },
    });
    expect(checkRequestSecurity(req, allowed)).toEqual({ ok: true });
  });

  test("rejects opaque null Origin", () => {
    const req = new Request("http://127.0.0.1/ping", {
      headers: { host: "127.0.0.1", origin: "null" },
    });
    expect(checkRequestSecurity(req, allowed)).toEqual({
      ok: false,
      reason: "origin",
    });
  });
});

describe("secureFetch", () => {
  test("returns 403 before calling inner on bad Host", async () => {
    let called = false;
    const wrapped = secureFetch(
      async () => {
        called = true;
        return new Response("ok");
      },
      undefined,
      "127.0.0.1",
    );
    const res = await wrapped(
      new Request("http://attacker.com/", {
        headers: { host: "attacker.com" },
      }),
    );
    expect(res.status).toBe(403);
    expect(called).toBe(false);
    expect(await res.text()).toContain("Host");
  });
});
