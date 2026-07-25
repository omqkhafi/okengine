import { describe, expect, test } from "bun:test";
import {
  fieldsFromSchema,
  formValuesToPayload,
  payloadToFormValues,
} from "./schema-form.ts";
import { SIGNALS_FIXTURE } from "./fixture.ts";

describe("schema-form", () => {
  test("builds editable fields from declared schema", () => {
    const order = SIGNALS_FIXTURE.find((s) => s.name === "order-placed")!;
    const fields = fieldsFromSchema(order.schema);
    expect(fields.map((f) => f.key)).toEqual([
      "orderId",
      "amount",
      "currency",
    ]);
    expect(fields.find((f) => f.key === "currency")?.enumValues).toEqual([
      "USD",
      "EUR",
    ]);
  });

  test("round-trips payload through form values", () => {
    const order = SIGNALS_FIXTURE.find((s) => s.name === "order-placed")!;
    const fields = fieldsFromSchema(order.schema);
    const dlq = order.deadLetters[0]!;
    const values = payloadToFormValues(dlq.payload, fields);
    values.amount = "99";
    const next = formValuesToPayload(values, fields) as Record<string, unknown>;
    expect(next.orderId).toBe("ord_1");
    expect(next.amount).toBe(99);
  });
});
