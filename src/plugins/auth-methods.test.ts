/**
 * Phase 2 Gate auth method plugins — username, anonymous, magic-link, email OTP.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { oke } from "../kernel/app.ts";
import { resetFlowSeq } from "../kernel/flow.ts";
import { resetBindings } from "../kernel/on.ts";
import { anonymous } from "./anonymous.ts";
import { magicLink } from "./magic-link.ts";
import { otp } from "./otp.ts";
import { username } from "./username.ts";

afterEach(() => {
  resetBindings();
  resetFlowSeq();
});

function authApp() {
  return oke({
    name: "auth-plugins",
    env: "test",
    registry: "ignore",
    gate: {
      auth: {
        secret: "test-secret-at-least-16",
        emailAndPassword: { enabled: true },
      },
    },
  })
    .plug(username())
    .plug(anonymous())
    .plug(magicLink({ exposeDevToken: true }))
    .plug(otp({ tier: 2, channels: ["email"], exposeDevOtp: true }));
}

describe("auth method plugins", () => {
  test("bindings appear on router after .plug()", async () => {
    const app = authApp();
    expect(app.router.match("POST", "/auth/sign-up/username")).toBeTruthy();
    expect(app.router.match("POST", "/auth/sign-in/username")).toBeTruthy();
    expect(app.router.match("POST", "/auth/sign-in/anonymous")).toBeTruthy();
    expect(app.router.match("POST", "/auth/magic-link/request")).toBeTruthy();
    expect(app.router.match("POST", "/auth/magic-link/verify")).toBeTruthy();
    expect(app.router.match("POST", "/auth/otp/request")).toBeTruthy();
    expect(app.router.match("POST", "/auth/otp/verify")).toBeTruthy();
    expect(app.router.match("POST", "/auth/otp/resend")).toBeTruthy();
    await app.boot({ env: "test" });
    await app.stop();
  });

  test("username sign-up + sign-in", async () => {
    const app = authApp();
    await app.boot({ env: "test" });

    const signUp = await app.fetch(
      new Request("http://localhost/auth/sign-up/username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "alice", password: "CorrectHorse1" }),
      }),
    );
    expect(signUp.status).toBe(200);
    const created = (await signUp.json()) as {
      data: { accessToken: string; userId: string };
    };
    expect(created.data.accessToken).toBeTruthy();
    expect(created.data.userId).toBeTruthy();

    const bad = await app.fetch(
      new Request("http://localhost/auth/sign-in/username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "alice", password: "wrong-password" }),
      }),
    );
    const badBody = (await bad.json()) as { error: { data?: { reason?: string } } };
    expect(badBody.error.data?.reason).toBe("invalid_credentials");

    const signIn = await app.fetch(
      new Request("http://localhost/auth/sign-in/username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "alice", password: "CorrectHorse1" }),
      }),
    );
    expect(signIn.status).toBe(200);
    const session = (await signIn.json()) as { data: { accessToken: string } };
    expect(session.data.accessToken).toBeTruthy();

    await app.stop();
  });

  test("anonymous sign-in issues session", async () => {
    const app = authApp();
    await app.boot({ env: "test" });

    const res = await app.fetch(
      new Request("http://localhost/auth/sign-in/anonymous", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { accessToken: string; userId: string };
    };
    expect(body.data.accessToken).toBeTruthy();
    expect(body.data.userId).toBeTruthy();

    await app.stop();
  });

  test("magic-link request + verify with devToken", async () => {
    const app = authApp();
    await app.boot({ env: "test" });

    const req = await app.fetch(
      new Request("http://localhost/auth/magic-link/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ml@example.com" }),
      }),
    );
    expect(req.status).toBe(200);
    const requested = (await req.json()) as { data: { ok: true; devToken?: string } };
    expect(requested.data.ok).toBe(true);
    expect(requested.data.devToken).toBeTruthy();

    const verify = await app.fetch(
      new Request("http://localhost/auth/magic-link/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: requested.data.devToken }),
      }),
    );
    expect(verify.status).toBe(200);
    const session = (await verify.json()) as { data: { accessToken: string; userId: string } };
    expect(session.data.accessToken).toBeTruthy();
    expect(session.data.userId).toBeTruthy();

    await app.stop();
  });

  test("email OTP request + verify with devOtp", async () => {
    const app = authApp();
    await app.boot({ env: "test" });

    const req = await app.fetch(
      new Request("http://localhost/auth/otp/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "otp@example.com" }),
      }),
    );
    expect(req.status).toBe(200);
    const requested = (await req.json()) as { data: { ok: true; devOtp?: string } };
    expect(requested.data.devOtp).toMatch(/^\d{6}$/);

    const verify = await app.fetch(
      new Request("http://localhost/auth/otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "otp@example.com",
          otp: requested.data.devOtp,
        }),
      }),
    );
    expect(verify.status).toBe(200);
    const session = (await verify.json()) as { data: { accessToken: string } };
    expect(session.data.accessToken).toBeTruthy();

    await app.stop();
  });
});
