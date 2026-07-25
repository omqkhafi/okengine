import { describe, expect, test } from "bun:test";
import { ACCESS_EFFECTIVE_FIXTURE } from "./fixture.ts";
import { formatProvenance } from "./provenance.ts";

describe("formatProvenance", () => {
  test("shows which role granted which scope", () => {
    const lines = formatProvenance(ACCESS_EFFECTIVE_FIXTURE);
    expect(lines.find((l) => l.scope === "booking:create")?.sources).toContain(
      "role member",
    );
  });
});
