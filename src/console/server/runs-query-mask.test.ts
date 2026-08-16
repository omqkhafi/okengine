import { describe, expect, test } from "bun:test";
import { PII_MASK } from "../../elements/store/classify.ts";
import { maskRunsQueryRows } from "./runs-query-mask.ts";

const PII = new Set(["email", "owner_email"]);

describe("maskRunsQueryRows", () => {
  test("masks dim_* promotions and JSON blobs", () => {
    const rows = maskRunsQueryRows(
      [
        {
          id: "r1",
          dim_email: "a@oke.com",
          input: JSON.stringify({ email: "a@oke.com", id: "b1" }),
          flow: "bookings.create",
        },
      ],
      PII,
    );
    expect(rows[0]!.dim_email).toBe(PII_MASK);
    expect(rows[0]!.flow).toBe("bookings.create");
    const input = JSON.parse(String(rows[0]!.input)) as { email: string; id: string };
    expect(input.email).toBe(PII_MASK);
    expect(input.id).toBe("b1");
  });

  test("RunsQueryPiiProjectionGap — alias leak is real, not silently closed", () => {
    const rows = maskRunsQueryRows([{ e: "a@oke.com", id: "r1" }], PII);
    expect(rows[0]!.e).toBe("a@oke.com");
    expect(rows[0]!.id).toBe("r1");
  });

  test("revealPii returns cleartext", () => {
    const rows = maskRunsQueryRows([{ dim_email: "a@oke.com" }], PII, true);
    expect(rows[0]!.dim_email).toBe("a@oke.com");
  });
});
