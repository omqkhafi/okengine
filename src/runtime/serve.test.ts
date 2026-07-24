import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { oke } from "../kernel/app.ts";
import { flow, resetFlowSeq } from "../kernel/flow.ts";
import { on, resetBindings } from "../kernel/on.ts";
import { http } from "../kernel/triggers.ts";
import { createBunRuntime } from "./bun.ts";
import { createWebStandardRuntime } from "./web-standard.ts";
import type { ServerHandle } from "./types.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

/**
 * Send a raw HTTP/1.1 request so the Host header is not rewritten by fetch.
 *
 * @param port - Listening port
 * @param payload - Full request bytes as text
 */
function rawHttp(port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        open(socket) {
          socket.write(payload);
        },
        data(_socket, data) {
          chunks.push(Buffer.from(data));
          if (Buffer.concat(chunks).toString("utf8").includes("\r\n\r\n")) {
            finish();
          }
        },
        close: finish,
        error(_socket, err) {
          if (!settled) {
            settled = true;
            reject(err);
          }
        },
      },
    }).catch(reject);
    setTimeout(() => finish(), 2000);
  });
}

function buildApp() {
  on(
    http.get("/ping"),
    flow({
      name: "ping",
      do: () => ({ ok: true as const, n: 1 }),
    }),
  );
  on(
    http.get("/notes/:id"),
    flow({
      name: "notes.get",
      do: ({ id }: { id: string }) => ({ id }),
    }),
  );
  return oke({ name: "runtime-serve" });
}

describe("Bun.serve — real HTTP", () => {
  let handle: ServerHandle | undefined;

  afterEach(() => {
    handle?.stop(true);
    handle = undefined;
  });

  test("a request to a flow returns its typed response", async () => {
    const app = buildApp();
    const rt = createBunRuntime();
    handle = rt.serve(app, { port: 0, hostname: "127.0.0.1" });

    const res = await fetch(new URL("/ping", handle.url));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { ok: true, n: 1 },
      error: null,
    });
  });

  test("Host: attacker.com returns 403", async () => {
    const app = buildApp();
    const rt = createBunRuntime();
    handle = rt.serve(app, { port: 0, hostname: "127.0.0.1" });

    // Pipeline-level (fetch() clients rewrite Host to the URL host).
    const direct = await handle.fetch(
      new Request(new URL("/ping", handle.url).href, {
        headers: { host: "attacker.com" },
      }),
    );
    expect(direct.status).toBe(403);
    expect(await direct.text()).toContain("Host");

    // On the wire — the DNS-rebinding shape (CVE-2025-66414 class).
    const wire = await rawHttp(handle.port, [
      "GET /ping HTTP/1.1",
      "Host: attacker.com",
      "Connection: close",
      "",
      "",
    ].join("\r\n"));
    expect(wire).toContain("403");
    expect(wire).toContain("Host");
  });

  test("allowedHosts accepts reverse-proxy hostname", async () => {
    const app = buildApp();
    const rt = createBunRuntime();
    handle = rt.serve(app, {
      port: 0,
      hostname: "127.0.0.1",
      allowedHosts: ["app.example.com"],
    });

    const ok = await handle.fetch(
      new Request("http://app.example.com/ping", {
        headers: { host: "app.example.com" },
      }),
    );
    expect(ok.status).toBe(200);

    const bad = await handle.fetch(
      new Request("http://evil.example.com/ping", {
        headers: { host: "evil.example.com" },
      }),
    );
    expect(bad.status).toBe(403);
  });

  test("param route serves through Bun native routes + app pipeline", async () => {
    const app = buildApp();
    const rt = createBunRuntime();
    handle = rt.serve(app, { port: 0, hostname: "127.0.0.1" });

    const res = await fetch(new URL("/notes/abc", handle.url));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { id: "abc" },
      error: null,
    });
  });

  test("sqlite and Bun.password are available", async () => {
    const rt = createBunRuntime();
    const db = rt.sqlite(":memory:");
    db.run("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    db.run("INSERT INTO t (v) VALUES (?)", ["hello"]);
    const row = db.query("SELECT v FROM t").get() as { v: string };
    expect(row.v).toBe("hello");
    db.close();

    const hash = await rt.crypto.hashPassword("secret");
    expect(await rt.crypto.verifyPassword("secret", hash)).toBe(true);
    expect(await rt.crypto.verifyPassword("nope", hash)).toBe(false);
  });
});

describe("web-standard adapter — identical behaviour", () => {
  test("same app object, same secured responses as Bun handle.fetch", async () => {
    const app = buildApp();
    const bun = createBunRuntime().serve(app, {
      port: 0,
      hostname: "127.0.0.1",
      allowedHosts: ["app.example.com"],
    });
    const web = createWebStandardRuntime().serve(app, {
      port: bun.port,
      hostname: "127.0.0.1",
      allowedHosts: ["app.example.com"],
    });

    try {
      const cases: Request[] = [
        new Request("http://127.0.0.1/ping", {
          headers: { host: "127.0.0.1" },
        }),
        new Request("http://127.0.0.1/notes/x", {
          headers: { host: "127.0.0.1" },
        }),
        new Request("http://attacker.com/ping", {
          headers: { host: "attacker.com" },
        }),
        new Request("http://127.0.0.1/ping", {
          headers: {
            host: "127.0.0.1",
            origin: "http://attacker.com",
          },
        }),
        new Request("http://app.example.com/ping", {
          headers: { host: "app.example.com" },
        }),
      ];

      for (const req of cases) {
        const twin = new Request(req.url, {
          method: req.method,
          headers: req.headers,
        });
        const [a, b] = await Promise.all([bun.fetch(req), web.fetch(twin)]);
        expect(b.status).toBe(a.status);
        expect(await b.text()).toBe(await a.text());
      }
    } finally {
      bun.stop(true);
      web.stop();
    }
  });
});
