/**
 * Username policy unit + sign-up integration.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { oke } from "../kernel/app.ts";
import { resetFlowSeq } from "../kernel/flow.ts";
import { resetBindings } from "../kernel/on.ts";
import {
  assertUsernamePolicy,
  DEFAULT_RESERVED_USERNAMES,
  DEFAULT_USERNAME_MAX_LENGTH,
  DEFAULT_USERNAME_MIN_LENGTH,
  resolveUsernamePolicy,
  username,
  UsernamePolicyError,
} from "./username.ts";

afterEach(() => {
  resetBindings();
  resetFlowSeq();
});

describe("username policy", () => {
  test("defaults: 3–64 from a-z0-9._-", () => {
    const policy = resolveUsernamePolicy();
    expect(policy.minLength).toBe(DEFAULT_USERNAME_MIN_LENGTH);
    expect(policy.maxLength).toBe(DEFAULT_USERNAME_MAX_LENGTH);
    expect(() => assertUsernamePolicy("ali")).not.toThrow();
    expect(() => assertUsernamePolicy("a.b_c-1")).not.toThrow();
    expect(() => assertUsernamePolicy("ab")).toThrow(UsernamePolicyError);
    expect(() => assertUsernamePolicy("ali!")).toThrow(UsernamePolicyError);
  });

  test("extraAllowedChars extends default; allowedChars replaces then extends", () => {
    expect(() => assertUsernamePolicy("al!ice")).toThrow(/allowedChars/);
    expect(() => assertUsernamePolicy("al!ice", { extraAllowedChars: "!" })).not.toThrow();
    expect(() => assertUsernamePolicy("al+ice", { extraAllowedChars: "!" })).toThrow(
      /allowedChars/,
    );

    const replaced = resolveUsernamePolicy({
      allowedChars: "abc",
      extraAllowedChars: "!",
    });
    expect(replaced.allowedChars).toBe("abc!");
    expect(() =>
      assertUsernamePolicy("a!b", {
        allowedChars: "abc",
        extraAllowedChars: "!",
        forbidEdgeSymbols: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertUsernamePolicy("ali", { allowedChars: "abc", extraAllowedChars: "!" }),
    ).toThrow(/allowedChars/);
  });

  test("requireLetter / requireNumber / requireSymbol", () => {
    expect(() => assertUsernamePolicy("12345", { minLength: 3, requireLetter: true })).toThrow(
      /requireLetter/,
    );
    expect(() => assertUsernamePolicy("alice", { minLength: 3, requireNumber: true })).toThrow(
      /requireNumber/,
    );
    expect(() => assertUsernamePolicy("alice1", { minLength: 3, requireSymbol: true })).toThrow(
      /requireSymbol/,
    );
    expect(() =>
      assertUsernamePolicy("alice.1", {
        minLength: 3,
        requireLetter: true,
        requireNumber: true,
        requireSymbol: true,
      }),
    ).not.toThrow();
  });

  test("default reserved blocks admin; [] opts out; custom replaces; extraReserved appends", () => {
    const policy = resolveUsernamePolicy();
    expect(policy.reserved.size).toBe(DEFAULT_RESERVED_USERNAMES.length);
    expect(() => assertUsernamePolicy("admin")).toThrow(/reserved/);
    expect(() => assertUsernamePolicy("anonymous")).toThrow(/reserved/);
    expect(() => assertUsernamePolicy("admin", { reserved: [] })).not.toThrow();
    expect(() => assertUsernamePolicy("admin", { reserved: ["brand"] })).not.toThrow();
    expect(() => assertUsernamePolicy("brand", { reserved: ["Brand"] })).toThrow(/reserved/);
    expect(() => assertUsernamePolicy("acme", { extraReserved: ["Acme"] })).toThrow(/reserved/);
    expect(() => assertUsernamePolicy("admin", { extraReserved: ["acme"] })).toThrow(/reserved/);
    const long = "a".repeat(DEFAULT_USERNAME_MAX_LENGTH + 1);
    expect(() => assertUsernamePolicy(long)).toThrow(/maxLength/);
  });

  test("shape rules: edge / consecutive symbols + mustStartWithLetter", () => {
    expect(() => assertUsernamePolicy(".alice")).toThrow(/forbidEdgeSymbols/);
    expect(() => assertUsernamePolicy("alice.")).toThrow(/forbidEdgeSymbols/);
    expect(() => assertUsernamePolicy("ali..ce")).toThrow(/forbidConsecutiveSymbols/);
    expect(() => assertUsernamePolicy("a.b_c-1")).not.toThrow();
    expect(() => assertUsernamePolicy(".alice", { forbidEdgeSymbols: false })).not.toThrow();
    expect(() => assertUsernamePolicy("12345", { mustStartWithLetter: true })).toThrow(
      /mustStartWithLetter/,
    );
    expect(() => assertUsernamePolicy("a2345", { mustStartWithLetter: true })).not.toThrow();
  });

  test("sign-up rejects default reserved names", async () => {
    const app = oke({
      name: "username-default-reserved",
      env: "test",
      registry: "ignore",
      gate: { auth: { secret: "test-secret-at-least-16" } },
    }).plug(username());
    await app.boot({ env: "test" });

    const res = await app.fetch(
      new Request("http://localhost/auth/sign-up/username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "Admin", password: "CorrectHorse1" }),
      }),
    );
    const body = (await res.json()) as {
      error: { data?: { reason?: string; reasons?: string[] } };
    };
    expect(body.error.data?.reason).toBe("username_policy");
    expect(body.error.data?.reasons).toContain("reserved");

    await app.stop();
  });

  test("sign-up returns username_policy / password_policy reasons", async () => {
    const app = oke({
      name: "username-policy",
      env: "test",
      registry: "ignore",
      gate: { auth: { secret: "test-secret-at-least-16" } },
    }).plug(
      username({
        usernamePolicy: {
          minLength: 5,
          requireLetter: true,
          requireNumber: true,
          reserved: ["root"],
        },
        passwordPolicy: {
          minLength: 12,
          requireLetter: true,
          requireNumber: true,
          requireSymbol: true,
        },
      }),
    );
    await app.boot({ env: "test" });

    const shortName = await app.fetch(
      new Request("http://localhost/auth/sign-up/username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "ab", password: "CorrectHorse1!" }),
      }),
    );
    const shortBody = (await shortName.json()) as {
      error: { data?: { reason?: string; reasons?: string[] } };
    };
    expect(shortBody.error.data?.reason).toBe("username_policy");
    expect(shortBody.error.data?.reasons?.some((r) => r.includes("minLength"))).toBe(true);

    const reserved = await app.fetch(
      new Request("http://localhost/auth/sign-up/username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "root", password: "CorrectHorse1!" }),
      }),
    );
    const reservedBody = (await reserved.json()) as {
      error: { data?: { reason?: string; reasons?: string[] } };
    };
    expect(reservedBody.error.data?.reason).toBe("username_policy");
    expect(reservedBody.error.data?.reasons).toContain("reserved");

    const weakPass = await app.fetch(
      new Request("http://localhost/auth/sign-up/username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "alice1", password: "CorrectHorse1" }),
      }),
    );
    const weakBody = (await weakPass.json()) as {
      error: { data?: { reason?: string; reasons?: string[] } };
    };
    expect(weakBody.error.data?.reason).toBe("password_policy");
    expect(weakBody.error.data?.reasons).toContain("requireSymbol");

    const ok = await app.fetch(
      new Request("http://localhost/auth/sign-up/username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "alice1", password: "CorrectHorse1!" }),
      }),
    );
    expect(ok.status).toBe(200);

    await app.stop();
  });

  test("default password policy rejects short passwords on sign-up", async () => {
    const app = oke({
      name: "username-default-pw",
      env: "test",
      registry: "ignore",
      gate: { auth: { secret: "test-secret-at-least-16" } },
    }).plug(username());
    await app.boot({ env: "test" });

    const res = await app.fetch(
      new Request("http://localhost/auth/sign-up/username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "alice", password: "short" }),
      }),
    );
    const body = (await res.json()) as {
      error: { data?: { reason?: string; reasons?: string[] } };
    };
    expect(body.error.data?.reason).toBe("password_policy");
    expect(body.error.data?.reasons?.some((r) => r.includes("minLength"))).toBe(true);

    await app.stop();
  });

  test("inherits gate.auth.passwordPolicy when plugin omits passwordPolicy", async () => {
    const app = oke({
      name: "username-inherit-pw",
      env: "test",
      registry: "ignore",
      gate: {
        auth: {
          secret: "test-secret-at-least-16",
          passwordPolicy: {
            minLength: 12,
            requireLetter: true,
            requireNumber: true,
            requireSymbol: true,
          },
        },
      },
    }).plug(username());
    await app.boot({ env: "test" });

    const weak = await app.fetch(
      new Request("http://localhost/auth/sign-up/username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "alice", password: "CorrectHorse1" }),
      }),
    );
    const weakBody = (await weak.json()) as {
      error: { data?: { reason?: string; reasons?: string[] } };
    };
    expect(weakBody.error.data?.reason).toBe("password_policy");
    expect(weakBody.error.data?.reasons).toContain("requireSymbol");

    const ok = await app.fetch(
      new Request("http://localhost/auth/sign-up/username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "alice", password: "CorrectHorse1!" }),
      }),
    );
    expect(ok.status).toBe(200);

    await app.stop();
  });

  test("inherits gate.auth.breachCheck on sign-up", async () => {
    const app = oke({
      name: "username-inherit-breach",
      env: "test",
      registry: "ignore",
      gate: {
        auth: {
          secret: "test-secret-at-least-16",
          breachCheck: async () => true,
        },
      },
    }).plug(username());
    await app.boot({ env: "test" });

    const res = await app.fetch(
      new Request("http://localhost/auth/sign-up/username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "alice", password: "CorrectHorse1" }),
      }),
    );
    const body = (await res.json()) as {
      error: { data?: { reason?: string } };
    };
    expect(body.error.data?.reason).toBe("password_breached");

    await app.stop();
  });
});
