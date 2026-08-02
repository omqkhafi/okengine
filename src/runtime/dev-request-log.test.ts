/**
 * Dev request log gating and silence rules.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  failureDetailFromResponse,
  isSilentDevRequest,
  shouldLogDevRequests,
} from "./dev-request-log.ts";

describe("dev-request-log", () => {
  const prev = process.env.OKE_DEV_REQUEST_LOG;

  afterEach(() => {
    if (prev === undefined) delete process.env.OKE_DEV_REQUEST_LOG;
    else process.env.OKE_DEV_REQUEST_LOG = prev;
  });

  test("shouldLogDevRequests follows OKE_DEV_REQUEST_LOG", () => {
    process.env.OKE_DEV_REQUEST_LOG = "1";
    expect(shouldLogDevRequests()).toBe(true);
    process.env.OKE_DEV_REQUEST_LOG = "0";
    expect(shouldLogDevRequests()).toBe(false);
  });

  test("isSilentDevRequest skips live, health, assets, client.json", () => {
    expect(isSilentDevRequest("GET", "/console/live")).toBe(true);
    expect(isSilentDevRequest("GET", "/health")).toBe(true);
    expect(isSilentDevRequest("GET", "/assets/index.js")).toBe(true);
    expect(isSilentDevRequest("GET", "/_oke/client.json")).toBe(true);
    expect(isSilentDevRequest("POST", "/console/flows")).toBe(false);
  });

  test("failureDetailFromResponse reads error.message from envelope", async () => {
    const res = Response.json(
      {
        data: null,
        error: {
          code: "ClaimFailed",
          data: { reason: "password_policy" },
          message: "Password needs at least 12 characters, including a letter and a number.",
        },
      },
      { status: 400 },
    );
    expect(await failureDetailFromResponse(res)).toMatch(/12 characters/);
  });
});
