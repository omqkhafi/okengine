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
    expect(sanitizeReturnTo("/overview")).toBe("/overview");
    expect(sanitizeReturnTo("/flows?flow=issues.create")).toBe("/flows?flow=issues.create");
    expect(sanitizeReturnTo("/store?resource=sql:issues&view=query&facet=sql")).toBe(
      "/store?resource=sql:issues&view=query&facet=sql",
    );
    expect(sanitizeReturnTo("/vault?name=STRIPE_KEY&action=rotate")).toBe(
      "/vault?name=STRIPE_KEY&action=rotate",
    );
  });

  test("rewrites legacy /units to /flows", () => {
    expect(sanitizeReturnTo("/units")).toBe("/flows");
    expect(sanitizeReturnTo("/units?flow=issues.create")).toBe("/flows?flow=issues.create");
  });

  test("rejects open redirects and non-shell paths", () => {
    expect(sanitizeReturnTo("https://evil.example")).toBeUndefined();
    expect(sanitizeReturnTo("//evil.example")).toBeUndefined();
    expect(sanitizeReturnTo("/\\evil.example")).toBeUndefined();
    expect(sanitizeReturnTo("/dashboard")).toBeUndefined();
    expect(sanitizeReturnTo("/overview/../store")).toBe("/store");
    expect(sanitizeReturnTo("/")).toBeUndefined();
    expect(sanitizeReturnTo("")).toBeUndefined();
    expect(sanitizeReturnTo(null)).toBeUndefined();
  });

  test("rejects oversized values", () => {
    expect(sanitizeReturnTo(`/store?resource=${"x".repeat(2000)}`)).toBeUndefined();
  });
});

describe("validateAuthSearch / authGateSearch", () => {
  test("omits the default Overview landing", () => {
    expect(validateAuthSearch({ next: "/overview" })).toEqual({});
    expect(authGateSearch("/overview")).toEqual({});
    expect(authGateSearch("/overview?run=pw-run-issues-create")).toEqual({
      next: "/overview?run=pw-run-issues-create",
    });
  });

  test("keeps a Store or Flows return path", () => {
    expect(authGateSearch("/store?resource=sql:issues")).toEqual({
      next: "/store?resource=sql:issues",
    });
    expect(authGateSearch("/flows?flow=issues.create")).toEqual({
      next: "/flows?flow=issues.create",
    });
    expect(authGateSearch("/units?flow=issues.create")).toEqual({
      next: "/flows?flow=issues.create",
    });
    expect(authGateSearch("/vault?name=STRIPE_KEY")).toEqual({
      next: "/vault?name=STRIPE_KEY",
    });
  });

  test("drops an unsafe next", () => {
    expect(validateAuthSearch({ next: "https://evil.example" })).toEqual({});
  });
});

describe("afterAuthLocation", () => {
  test("falls back to Overview", () => {
    expect(afterAuthLocation(undefined)).toEqual({ to: DEFAULT_AFTER_AUTH, search: {} });
    expect(afterAuthLocation("/dashboard")).toEqual({ to: "/overview", search: {} });
  });

  test("rehydrates typed search on each module", () => {
    expect(afterAuthLocation("/overview?run=pw-run-issues-create&flow=issues.create")).toEqual({
      to: "/overview",
      search: { run: "pw-run-issues-create", flow: "issues.create" },
    });
    expect(afterAuthLocation("/flows?flow=issues.create")).toEqual({
      to: "/flows",
      search: { flow: "issues.create" },
    });
    expect(afterAuthLocation("/units?flow=issues.create")).toEqual({
      to: "/flows",
      search: { flow: "issues.create" },
    });
    expect(afterAuthLocation("/store?resource=sql:issues&view=query&facet=sql")).toEqual({
      to: "/store",
      search: { resource: "sql:issues", view: "query", facet: "sql" },
    });
    expect(afterAuthLocation("/vault?name=STRIPE_KEY&action=rotate-master")).toEqual({
      to: "/vault",
      search: { name: "STRIPE_KEY", action: "rotate-master" },
    });
  });
});
