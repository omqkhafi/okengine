import { describe, expect, test } from "bun:test";
import { PII_MASK } from "../../../../../../elements/store/classify.ts";
import { formatCallApiResponseJson, formatInvokeResponseJson } from "./invoke-response.ts";
import type { FlowsInvokeResult } from "@/client.ts";

function result(over: Partial<FlowsInvokeResult>): FlowsInvokeResult {
  return {
    ok: true,
    flowId: "issues.list",
    asUserId: "user_member",
    trigger: "http",
    response: null,
    masked: true,
    peakTier: "reads",
    auditedAt: 1,
    ...over,
  };
}

describe("formatInvokeResponseJson", () => {
  test("success shows the handler output, not a status envelope", () => {
    const json = formatInvokeResponseJson(
      result({
        status: 200,
        response: { items: [{ id: "iss_1" }], count: 1 },
      }),
    );
    expect(JSON.parse(json)).toEqual({ items: [{ id: "iss_1" }], count: 1 });
  });

  test("missing output keeps an explicit null response", () => {
    const json = formatInvokeResponseJson(result({ status: 200, response: undefined }));
    expect(JSON.parse(json)).toEqual({ status: 200, failure: null, response: null });
  });

  test("failure keeps the envelope", () => {
    const json = formatInvokeResponseJson(
      result({
        status: 403,
        failure: { code: "Forbidden" },
        response: null,
      }),
    );
    expect(JSON.parse(json)).toEqual({
      status: 403,
      failure: { code: "Forbidden" },
      response: null,
    });
  });
});

describe("formatCallApiResponseJson", () => {
  test("remasks revealed PII synchronously when the toggle is off", () => {
    const json = formatCallApiResponseJson(
      result({
        masked: false,
        response: { id: "view_web_board", ownerEmail: "aria@keel.dev" },
      }),
      true,
      new Set(["ownerEmail"]),
    );
    expect(JSON.parse(json)).toEqual({ id: "view_web_board", ownerEmail: PII_MASK });
  });

  test("keeps cleartext when Include PII is on", () => {
    const json = formatCallApiResponseJson(
      result({
        masked: false,
        response: { id: "view_web_board", ownerEmail: "aria@keel.dev" },
      }),
      false,
      new Set(["ownerEmail"]),
    );
    expect(JSON.parse(json)).toEqual({ id: "view_web_board", ownerEmail: "aria@keel.dev" });
  });
});
