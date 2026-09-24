/**
 * HTTP wire-frame capture redacts credentials and keeps the rest.
 */

import { describe, expect, test } from "bun:test";
import {
  HTTP_FRAME_REDACTED,
  captureHttpFrame,
  redactHttpFrame,
  requestForHttpInvoke,
} from "./http-frame.ts";

describe("requestForHttpInvoke", () => {
  test("GET puts scalar input on the query string and keeps accept", () => {
    const request = requestForHttpInvoke(
      { method: "GET", path: "/tasks/:id" },
      { pathParams: { id: "tsk_1" }, input: { id: "tsk_1", limit: 20 } },
    );
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/tasks/tsk_1");
    expect(new URL(request.url).searchParams.get("limit")).toBe("20");
    expect(new URL(request.url).searchParams.has("id")).toBe(false);
    expect(request.headers.get("accept")).toBe("application/json");
    expect(request.headers.get("content-type")).toBeNull();
  });
});

describe("captureHttpFrame", () => {
  test("keeps method, path, query, and headers and redacts credentials", () => {
    const request = new Request("http://localhost/tasks?limit=20&token=sekrit", {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: "Bearer super-secret",
        cookie: "oke_session=abc",
        "x-request-id": "req_1",
      },
    });
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": "oke_session=next; HttpOnly",
      },
    });

    expect(captureHttpFrame(request, response)).toEqual({
      request: {
        method: "GET",
        path: "/tasks",
        query: { limit: "20", token: HTTP_FRAME_REDACTED },
        headers: {
          accept: "application/json",
          authorization: HTTP_FRAME_REDACTED,
          cookie: HTTP_FRAME_REDACTED,
          "x-request-id": "req_1",
        },
      },
      response: {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": HTTP_FRAME_REDACTED,
        },
      },
    });
  });

  test("redactHttpFrame masks a frame that skipped capture", () => {
    expect(
      redactHttpFrame({
        request: {
          method: "POST",
          path: "/tasks",
          query: {},
          headers: { authorization: "Bearer leak", host: "localhost" },
        },
        response: { status: 201, headers: { "x-api-key": "leak" } },
      }),
    ).toEqual({
      request: {
        method: "POST",
        path: "/tasks",
        query: {},
        headers: { authorization: HTTP_FRAME_REDACTED, host: "localhost" },
      },
      response: {
        status: 201,
        headers: { "x-api-key": HTTP_FRAME_REDACTED },
      },
    });
  });
});
