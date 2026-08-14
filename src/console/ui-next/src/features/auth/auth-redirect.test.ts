import { describe, expect, test } from "bun:test";
import {
  afterAuthLocation,
  authGateSearch,
  DEFAULT_AFTER_AUTH,
  sanitizeReturnTo,
  validateAuthSearch,
} from "./auth-redirect.ts";

describe("sanitizeReturnTo", () => {
  test("keeps shell modules and their search", () => {
    expect(sanitizeReturnTo("/flows")).toBe("/flows");
    expect(sanitizeReturnTo("/units?flow=issues.create")).toBe("/units?flow=issues.create");
    expect(sanitizeReturnTo("/store?resource=sql:issues&view=query&facet=sql")).toBe(
      "/store?resource=sql:issues&view=query&facet=sql",
    );
  });

  test("rejects open redirects and non-shell paths", () => {
    expect(sanitizeReturnTo("https://evil.example")).toBeUndefined();
    expect(sanitizeReturnTo("//evil.example")).toBeUndefined();
    expect(sanitizeReturnTo("/\\evil.example")).toBeUndefined();
    expect(sanitizeReturnTo("/overview")).toBeUndefined();
    expect(sanitizeReturnTo("/flows/../store")).toBe("/store");
    expect(sanitizeReturnTo("/")).toBeUndefined();
    expect(sanitizeReturnTo("")).toBeUndefined();
    expect(sanitizeReturnTo(null)).toBeUndefined();
  });

  test("rejects oversized values", () => {
    expect(sanitizeReturnTo(`/store?resource=${"x".repeat(2000)}`)).toBeUndefined();
  });
});

describe("validateAuthSearch / authGateSearch", () => {
  test("omits the default Flows landing", () => {
    expect(validateAuthSearch({ next: "/flows" })).toEqual({});
    expect(authGateSearch("/flows")).toEqual({});
    expect(authGateSearch("/flows?run=pw-run-issues-create")).toEqual({
      next: "/flows?run=pw-run-issues-create",
    });
  });

  test("keeps a Store or Units return path", () => {
    expect(authGateSearch("/store?resource=sql:issues")).toEqual({
      next: "/store?resource=sql:issues",
    });
    expect(authGateSearch("/units?flow=issues.create")).toEqual({
      next: "/units?flow=issues.create",
    });
  });

  test("drops an unsafe next", () => {
    expect(validateAuthSearch({ next: "https://evil.example" })).toEqual({});
  });
});

describe("afterAuthLocation", () => {
  test("falls back to Flows", () => {
    expect(afterAuthLocation(undefined)).toEqual({ to: DEFAULT_AFTER_AUTH, search: {} });
    expect(afterAuthLocation("/overview")).toEqual({ to: "/flows", search: {} });
  });

  test("rehydrates typed search on each module", () => {
    expect(afterAuthLocation("/flows?run=pw-run-issues-create&flow=issues.create")).toEqual({
      to: "/flows",
      search: { run: "pw-run-issues-create", flow: "issues.create" },
    });
    expect(afterAuthLocation("/units?flow=issues.create")).toEqual({
      to: "/units",
      search: { flow: "issues.create" },
    });
    expect(afterAuthLocation("/store?resource=sql:issues&view=query&facet=sql")).toEqual({
      to: "/store",
      search: { resource: "sql:issues", view: "query", facet: "sql" },
    });
  });
});
