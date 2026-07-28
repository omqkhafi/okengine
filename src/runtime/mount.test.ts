/**
 * mount() — host → OKE incremental adoption.
 *
 * Evidence: Hono mounts the fetch handler with zero conversion; Express
 * middleware bridges req/res and still enforces gates.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";
import { gate } from "../elements/gate.ts";
import { oke } from "../kernel/app.ts";
import { flow, resetFlowSeq } from "../kernel/flow.ts";
import { on, resetBindings } from "../kernel/on.ts";
import { http } from "../kernel/triggers.ts";
import {
  createExpressMiddleware,
  mount,
  nodeRequestToWeb,
  webResponseToNode,
  type ExpressLikeRequest,
  type ExpressLikeResponse,
} from "./mount.ts";

const member = gate.policy("member", ({ auth }) => !!auth.verified);

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

async function buildGatedApp() {
  on(
    http.post("/pings").gate(member),
    flow({
      name: "main.create",
      in: z.object({ note: z.string() }),
      out: z.object({ id: z.string() }),
      do: (input, fx) => ({ id: fx.id(), note: input.note }),
    }),
  );
  on(
    http.get("/pings/:id"),
    flow({
      name: "main.get",
      do: ({ id }: { id: string }) => ({ id, note: "ok" }),
    }),
  );
  const app = oke({
    name: "mount-demo",
    gates: [member],
    env: "test",
  });
  await app.boot({ env: "test", gates: [member] });
  return app;
}

describe("mount — Hono (zero conversion)", () => {
  afterEach(async () => {
    // apps closed per-test via bootResult
  });

  test("host mounts OKE fetch; typed response out; gates still enforced", async () => {
    const app = await buildGatedApp();
    const handle = mount(app, { trustHost: true });

    const host = new Hono();
    host.get("/legacy", (c) => c.json({ legacy: true }));
    host.mount("/oke", handle.fetch);

    // Legacy route untouched
    const legacy = await host.request("http://localhost/legacy");
    expect(legacy.status).toBe(200);
    expect(await legacy.json()).toEqual({ legacy: true });

    // Mounted OKE flow — path rewrite strips /oke
    const ok = await host.request("http://localhost/oke/pings/abc");
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as {
      data: { id: string; note: string };
      error: null;
    };
    expect(okBody.error).toBeNull();
    expect(okBody.data).toEqual({ id: "abc", note: "ok" });

    // Gate still enforced on mounted path
    const denied = await host.request("http://localhost/oke/pings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "x" }),
    });
    expect(denied.status).toBe(401);
    const deniedBody = (await denied.json()) as {
      data: null;
      error: { code: string };
    };
    expect(deniedBody.error.code).toBe("Unauthorized");

    await app.bootResult?.close();
  });
});

describe("mount — Express middleware bridge", () => {
  test("nodeRequestToWeb / webResponseToNode round-trip", async () => {
    const chunks = [Buffer.from('{"note":"hi"}')];
    const req: ExpressLikeRequest = {
      method: "POST",
      url: "/pings",
      headers: {
        host: "127.0.0.1:3000",
        "content-type": "application/json",
        connection: "keep-alive",
      },
      async *[Symbol.asyncIterator]() {
        for (const c of chunks) yield c;
      },
    };

    const web = await nodeRequestToWeb(req);
    expect(web.method).toBe("POST");
    expect(new URL(web.url).pathname).toBe("/pings");
    expect(web.headers.get("content-type")).toBe("application/json");
    expect(web.headers.get("connection")).toBeNull();
    expect(await web.text()).toBe('{"note":"hi"}');

    const response = Response.json({ data: { ok: true }, error: null });
    let ended: Buffer | undefined;
    const res: ExpressLikeResponse = {
      statusCode: 0,
      setHeader() {
        return this;
      },
      end(chunk) {
        ended = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as string);
      },
      write() {
        return true;
      },
    };
    await webResponseToNode(response, res);
    expect(res.statusCode).toBe(200);
    expect(ended && JSON.parse(ended.toString())).toEqual({
      data: { ok: true },
      error: null,
    });
  });

  test("asExpress middleware: request in, gated response out", async () => {
    const app = await buildGatedApp();
    const mw = mount(app, { trustHost: true }).asExpress();

    const deniedReq: ExpressLikeRequest = {
      method: "POST",
      url: "/pings",
      headers: {
        host: "127.0.0.1",
        "content-type": "application/json",
      },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(JSON.stringify({ note: "x" }));
      },
    };

    let status = 0;
    let body: Uint8Array = new Uint8Array();
    const headers: Record<string, string> = {};
    const deniedRes: ExpressLikeResponse = {
      statusCode: 0,
      setHeader(name, value) {
        headers[name.toLowerCase()] = String(value);
        return this;
      },
      end(chunk) {
        status = this.statusCode;
        body = Buffer.isBuffer(chunk)
          ? new Uint8Array(chunk)
          : new TextEncoder().encode(String(chunk ?? ""));
      },
      write() {
        return true;
      },
    };

    await mw(deniedReq, deniedRes, (err) => {
      if (err) throw err;
    });
    expect(status).toBe(401);
    expect(JSON.parse(new TextDecoder().decode(body)).error.code).toBe(
      "Unauthorized",
    );

    // Open GET flow succeeds through the same middleware
    const getReq: ExpressLikeRequest = {
      method: "GET",
      url: "/pings/n1",
      headers: { host: "127.0.0.1" },
    };
    let getStatus = 0;
    let getBody: Uint8Array = new Uint8Array();
    const getRes: ExpressLikeResponse = {
      statusCode: 0,
      setHeader() {
        return this;
      },
      end(chunk) {
        getStatus = this.statusCode;
        getBody = Buffer.isBuffer(chunk)
          ? new Uint8Array(chunk)
          : new TextEncoder().encode(String(chunk ?? ""));
      },
      write() {
        return true;
      },
    };
    await createExpressMiddleware(mount(app, { trustHost: true }).fetch)(
      getReq,
      getRes,
      (err) => {
        if (err) throw err;
      },
    );
    expect(getStatus).toBe(200);
    expect(JSON.parse(new TextDecoder().decode(getBody)).data).toEqual({
      id: "n1",
      note: "ok",
    });

    await app.bootResult?.close();
  });
});
