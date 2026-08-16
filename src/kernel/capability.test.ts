import { describe, expect, test } from "bun:test";
import { createCapabilityToken } from "./capability.ts";
import { OkeError } from "./errors.ts";

describe("capability — prompt pin matching", () => {
  test("declared name@version allows asking the bare prompt name", () => {
    const token = createCapabilityToken("documents.summarize", {
      asks: ["document-summary@1"],
    });
    expect(token.allows("ask", "document-summary")).toBe(true);
    expect(() => token.assert("ask", "document-summary")).not.toThrow();
  });

  test("declared bare name allows asking a pinned PromptRef", () => {
    const token = createCapabilityToken("documents.summarize", {
      asks: ["document-summary"],
    });
    expect(token.allows("ask", "document-summary@1")).toBe(true);
  });

  test("distinct pins of the same prompt do not match", () => {
    const token = createCapabilityToken("documents.summarize", {
      asks: ["document-summary@1"],
    });
    expect(token.allows("ask", "document-summary@2")).toBe(false);
    expect(() => token.assert("ask", "document-summary@2")).toThrow(OkeError);
  });

  test("a different prompt name is still denied", () => {
    const token = createCapabilityToken("documents.summarize", {
      asks: ["document-summary@1"],
    });
    expect(token.allows("ask", "form-classify")).toBe(false);
  });

  test("pin matching does not apply to other effect kinds", () => {
    const token = createCapabilityToken("mail.send", {
      sends: ["welcome@1"],
    });
    expect(token.allows("send", "welcome")).toBe(false);
  });
});
