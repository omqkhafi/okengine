/**
 * Transport — retry, timeout, auth refresh.
 */

import { describe, expect, test } from "bun:test";
import { createClient } from "./create.ts";
import type { AppOf } from "./types.ts";

type PingApp = AppOf<{
  sys: {
    ping: {
      out: { ok: true };
      errors: Record<string, never>;
    };
  };
}>;

describe("transport — retry", () => {
  test("retries 5xx then succeeds", async () => {
    let n = 0;
    const api = createClient<PingApp>("http://app.test", {
      retry: { retries: 2, delay: 1, backoff: 1 },
      fetch: async () => {
        n += 1;
        if (n < 3) return new Response("nope", { status: 503 });
        return Response.json({ data: { ok: true }, error: null });
      },
    });

    const { data, error } = await api.sys.ping();
    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });
    expect(n).toBe(3);
  });

  test("exhausts retries into TransportError", async () => {
    let n = 0;
    const api = createClient<PingApp>("http://app.test", {
      retry: { retries: 1, delay: 1, backoff: 1 },
      fetch: async () => {
        n += 1;
        return new Response("nope", { status: 502 });
      },
    });

    const { error } = await api.sys.ping();
    expect(error?.code).toBe("TransportError");
    expect(n).toBe(2);
  });

  test("structured 5xx envelope is returned (not TransportError)", async () => {
    const api = createClient<PingApp>("http://app.test", {
      fetch: async () =>
        Response.json(
          {
            data: null,
            error: {
              code: "InternalError",
              data: {},
              message: "password policy failed: minLength 12",
            },
          },
          { status: 500 },
        ),
    });

    const { error } = await api.sys.ping();
    expect(error?.code).toBe("InternalError");
    expect(error?.message).toMatch(/password policy/i);
  });
});

describe("transport — timeout", () => {
  test("AbortError becomes TransportError", async () => {
    const api = createClient<PingApp>("http://app.test", {
      timeout: 10,
      fetch: async (_input, init) => {
        const signal = init?.signal;
        await new Promise<void>((resolve, reject) => {
          if (!signal) {
            resolve();
            return;
          }
          if (signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
        return Response.json({ data: { ok: true }, error: null });
      },
    });

    const { error } = await api.sys.ping();
    expect(error?.code).toBe("TransportError");
  });
});

describe("transport — auth refresh", () => {
  test("401 triggers refresh once and retries", async () => {
    let token = "old";
    let refreshes = 0;
    let auths: Array<string | null> = [];

    const api = createClient<PingApp>("http://app.test", {
      auth: {
        getToken: () => token,
        refresh: async () => {
          refreshes += 1;
          token = "new";
          return token;
        },
      },
      fetch: async (_input, init) => {
        const headers = new Headers(init?.headers);
        const auth = headers.get("authorization");
        auths.push(auth);
        if (auth === "Bearer old") {
          return new Response("unauthorized", { status: 401 });
        }
        return Response.json({ data: { ok: true }, error: null });
      },
    });

    const { data, error } = await api.sys.ping();
    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });
    expect(refreshes).toBe(1);
    expect(auths).toEqual(["Bearer old", "Bearer new"]);
  });

  test("401 without refresh returns TransportError envelope", async () => {
    const api = createClient<PingApp>("http://app.test", {
      fetch: async () => new Response("no", { status: 401 }),
    });
    const { error } = await api.sys.ping();
    expect(error?.code).toBe("TransportError");
    if (error?.code === "TransportError") {
      expect(error.data.status).toBe(401);
    }
  });
});
