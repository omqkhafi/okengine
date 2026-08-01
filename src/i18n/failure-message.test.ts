import { describe, expect, test } from "bun:test";
import { fail } from "../kernel/errors.ts";
import { OKE_ERRORS, OkeError } from "../kernel/errors.ts";
import { catalogReasonKey, resolveFailureMessage } from "./failure-message.ts";
import { runWithLocale } from "./locale-context.ts";

describe("catalogReasonKey", () => {
  test("keeps identifiers; slugifies free text", () => {
    expect(catalogReasonKey("invalid_credentials")).toBe("invalid_credentials");
    expect(catalogReasonKey("policy denied")).toBe("policy_denied");
  });
});

describe("resolveFailureMessage", () => {
  test("resolves reason-specific then code-level keys", () => {
    expect(resolveFailureMessage("AuthFailed", { reason: "invalid_credentials" }, "en")).toBe(
      "Invalid credentials.",
    );
    expect(resolveFailureMessage("AuthFailed", { reason: "invalid_credentials" }, "ar")).toBe(
      "بيانات الاعتماد غير صحيحة.",
    );
    expect(resolveFailureMessage("Unauthorized", {}, "ar")).toBe("المصادقة مطلوبة.");
    expect(resolveFailureMessage("FlightFull", { seats: 0 }, "en")).toBeUndefined();
  });
});

describe("fail — auto message", () => {
  test("attaches localized message from active locale", () => {
    const en = runWithLocale({ locale: "en", defaultLocale: "en" }, () =>
      fail("AuthFailed", { reason: "invalid_email" }),
    );
    expect(en.error.message).toBe("Enter a valid email address.");

    const ar = runWithLocale({ locale: "ar", defaultLocale: "en" }, () => fail("NotFound", {}));
    expect(ar.error.message).toBe("المورد المطلوب غير موجود.");
  });

  test("explicit message wins", () => {
    const r = fail("AuthFailed", { reason: "invalid_email" }, { message: "custom" });
    expect(r.error.message).toBe("custom");
  });
});

describe("OkeError — localized cause/fix", () => {
  test("uses Arabic catalog when locale is ar", () => {
    const err = new OkeError(
      OKE_ERRORS.UNDECLARED_READ,
      { flow: "notes.create", resource: "sql:notes" },
      "ar",
    );
    expect(err.causeText).toContain("notes.create");
    expect(err.causeText).toContain("sql:notes");
    expect(err.causeText).toContain("يقرأ");
    expect(err.fix).toContain("effects.reads");
  });
});
