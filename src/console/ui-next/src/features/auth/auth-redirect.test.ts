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
    expect(sanitizeReturnTo("/overview?flow=issues.create")).toBe("/overview?flow=issues.create");
    expect(sanitizeReturnTo("/flows?flow=issues.create")).toBe("/flows?flow=issues.create");
    expect(sanitizeReturnTo("/store?resource=sql:issues&view=query&facet=sql")).toBe(
      "/store?resource=sql:issues&view=query&facet=sql",
    );
    expect(sanitizeReturnTo("/vault?name=STRIPE_KEY&action=rotate")).toBe(
      "/vault?name=STRIPE_KEY&action=rotate",
    );
    expect(sanitizeReturnTo("/observability?window=7d")).toBe("/observability?window=7d");
    expect(sanitizeReturnTo("/monitoring?window=7d")).toBe("/observability?window=7d");
  });

  test("rejects unknown paths including /units", () => {
    expect(sanitizeReturnTo("/units")).toBeUndefined();
    expect(sanitizeReturnTo("/units?flow=issues.create")).toBeUndefined();
  });

  test("rejects open redirects and non-shell paths", () => {
    expect(sanitizeReturnTo("https://evil.example")).toBeUndefined();
    expect(sanitizeReturnTo("//evil.example")).toBeUndefined();
    expect(sanitizeReturnTo("/\\evil.example")).toBeUndefined();
    expect(sanitizeReturnTo("/dashboard")).toBeUndefined();
    expect(sanitizeReturnTo("/units/../store")).toBe("/store");
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
    expect(authGateSearch("/units")).toEqual({});
    expect(authGateSearch("/overview?run=pw-run-issues-create")).toEqual({
      next: "/overview?run=pw-run-issues-create",
    });
  });

  test("keeps a Store, Flows, or Overview return path", () => {
    expect(authGateSearch("/store?resource=sql:issues")).toEqual({
      next: "/store?resource=sql:issues",
    });
    expect(authGateSearch("/overview?flow=issues.create")).toEqual({
      next: "/overview?flow=issues.create",
    });
    expect(authGateSearch("/flows?flow=issues.create")).toEqual({
      next: "/flows?flow=issues.create",
    });
    expect(authGateSearch("/units?flow=issues.create")).toEqual({});
    expect(authGateSearch("/vault?name=STRIPE_KEY")).toEqual({
      next: "/vault?name=STRIPE_KEY",
    });
    expect(authGateSearch("/observability?window=7d")).toEqual({
      next: "/observability?window=7d",
    });
    expect(authGateSearch("/monitoring?window=7d")).toEqual({
      next: "/observability?window=7d",
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
      to: "/overview",
      search: {},
    });
    expect(afterAuthLocation("/store?resource=sql:issues&view=query&facet=sql")).toEqual({
      to: "/store",
      search: { resource: "sql:issues", view: "query", facet: "sql" },
    });
    expect(afterAuthLocation("/vault?name=STRIPE_KEY&action=rotate-master")).toEqual({
      to: "/vault",
      search: { name: "STRIPE_KEY", action: "rotate-master" },
    });
    expect(afterAuthLocation("/observability?window=7d&run=r1")).toEqual({
      to: "/observability",
      search: { window: "7d", run: "r1" },
    });
    expect(afterAuthLocation("/monitoring?window=7d&run=r1")).toEqual({
      to: "/observability",
      search: { window: "7d", run: "r1" },
    });
  });
});
