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

const getPing = {
  "sys.ping": { method: "GET", path: "/ping" },
} as const;

describe("transport — retry", () => {
  test("retries 5xx then succeeds", async () => {
    let n = 0;
    const api = createClient<PingApp>("http://app.test", {
      retry: { retries: 2, delay: 1, backoff: 1 },
      routes: getPing,
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
      routes: getPing,
      fetch: async () => {
        n += 1;
        return new Response("nope", { status: 502 });
      },
    });

    const { error } = await api.sys.ping();
    expect(error?.code).toBe("TransportError");
    expect(n).toBe(2);
    if (error?.code === "TransportError") {
      expect(typeof error.message).toBe("string");
      expect(error.message.length).toBeGreaterThan(0);
      expect(error.message).toBe(error.data.message);
    }
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

  test("POST network error is not re-sent unless the call opts in", async () => {
    let handled = 0;
    const api = createClient<PingApp>("http://app.test", {
      retry: { retries: 2, delay: 1, backoff: 1 },
      fetch: async () => {
        handled += 1;
        throw new TypeError("Failed to fetch");
      },
    });

    const lost = await api.sys.ping();
    expect(lost.error?.code).toBe("TransportError");
    expect(handled).toBe(1);

    handled = 0;
    const opted = await api.sys.ping({ retry: true });
    expect(opted.error?.code).toBe("TransportError");
    expect(handled).toBe(3);
  });

  test("GET still retries a network error", async () => {
    let n = 0;
    const api = createClient<PingApp>("http://app.test", {
      retry: { retries: 1, delay: 1, backoff: 1 },
      routes: getPing,
      fetch: async () => {
        n += 1;
        if (n < 2) throw new TypeError("Failed to fetch");
        return Response.json({ data: { ok: true }, error: null });
      },
    });

    const { data, error } = await api.sys.ping();
    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });
    expect(n).toBe(2);
  });

  test("QUERY still retries a network error", async () => {
    let n = 0;
    const api = createClient<PingApp>("http://app.test", {
      retry: { retries: 1, delay: 1, backoff: 1 },
      routes: { "sys.ping": { method: "QUERY", path: "/ping" } },
      fetch: async () => {
        n += 1;
        if (n < 2) throw new TypeError("Failed to fetch");
        return Response.json({ data: { ok: true }, error: null });
      },
    });

    const { data, error } = await api.sys.ping();
    expect(error).toBeNull();
    expect(data).toEqual({ ok: true });
    expect(n).toBe(2);
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
      expect(error.message).toBe(error.data.message);
      expect(error.message).toBe("Invalid JSON (401)");
    }
  });
});

describe("transport — TransportError message contract", () => {
  test("empty error body populates matching message fields", async () => {
    const api = createClient<PingApp>("http://app.test", {
      fetch: async () => new Response("", { status: 404 }),
    });
    const { error } = await api.sys.ping();
    expect(error?.code).toBe("TransportError");
    if (error?.code === "TransportError") {
      expect(error.message).toBe("HTTP 404");
      expect(error.message).toBe(error.data.message);
      expect(error.data.status).toBe(404);
    }
  });

  test("malformed JSON populates matching message fields", async () => {
    const api = createClient<PingApp>("http://app.test", {
      fetch: async () =>
        new Response("not-json", {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    });
    const { error } = await api.sys.ping();
    expect(error?.code).toBe("TransportError");
    if (error?.code === "TransportError") {
      expect(error.message).toBe("Invalid JSON (400)");
      expect(error.message).toBe(error.data.message);
      expect(error.data.status).toBe(400);
    }
  });

  test("incomplete proxy path populates matching message fields", async () => {
    const api = createClient<PingApp>("http://app.test", {
      fetch: async () => Response.json({ data: { ok: true }, error: null }),
    });
    // path stops at unit — api.sys() is incomplete
    const result = await (
      api.sys as unknown as () => Promise<{
        error: { code: string; message: string; data: { message: string } };
      }>
    )();
    expect(result.error.code).toBe("TransportError");
    expect(result.error.message).toMatch(/Incomplete path/);
    expect(result.error.message).toBe(result.error.data.message);
  });

  test("binary error path populates matching message fields", async () => {
    const api = createClient<PingApp>("http://app.test", {
      fetch: async () => new Response("nope", { status: 403 }),
    });
    const { error } = await api.sys.ping({ response: "blob" });
    expect(error?.code).toBe("TransportError");
    if (error?.code === "TransportError") {
      expect(error.message).toBe("HTTP 403");
      expect(error.message).toBe(error.data.message);
      expect(error.data.status).toBe(403);
    }
  });
});

describe("transport — binary response", () => {
  test("response blob returns Blob data", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]); // %PDF
    const api = createClient<PingApp>("http://app.test", {
      fetch: async () =>
        new Response(bytes, {
          status: 200,
          headers: { "content-type": "application/pdf" },
        }),
    });
    const { data, error } = await api.sys.ping({ response: "blob" });
    expect(error).toBeNull();
    expect(data).toBeInstanceOf(Blob);
    expect((data as unknown as Blob).type).toContain("pdf");
  });

  test("response arrayBuffer returns bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const api = createClient<PingApp>("http://app.test", {
      fetch: async () =>
        new Response(bytes, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
    });
    const { data, error } = await api.sys.ping({ response: "arrayBuffer" });
    expect(error).toBeNull();
    expect(data).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(data as unknown as ArrayBuffer)).toEqual(bytes);
  });
});
