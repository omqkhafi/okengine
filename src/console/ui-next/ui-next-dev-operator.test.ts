/**
 * Unit tests for the fixed console-next dev operator helper.
 */

import { describe, expect, test } from "bun:test";
import { authenticateOperator } from "../../auth/operator.ts";
import {
  isConsoleFresh,
  seedUiNextDevOperator,
  UI_NEXT_DEV_OPERATOR,
  UI_NEXT_DEV_OPERATOR_EMAIL,
  UI_NEXT_DEV_OPERATOR_NAME,
  UI_NEXT_DEV_OPERATOR_PASSWORD,
} from "./ui-next-dev-operator.ts";

describe("ui-next dev operator", () => {
  test("fresh env flag is explicit", () => {
    const prev = process.env["OKE_CONSOLE_FRESH"];
    try {
      delete process.env["OKE_CONSOLE_FRESH"];
      expect(isConsoleFresh()).toBe(false);
      process.env["OKE_CONSOLE_FRESH"] = "1";
      expect(isConsoleFresh()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env["OKE_CONSOLE_FRESH"];
      else process.env["OKE_CONSOLE_FRESH"] = prev;
    }
  });

  test("seeded operator authenticates with documented credentials", async () => {
    const { store, operatorId } = await seedUiNextDevOperator();
    expect(store.operators.size).toBe(1);
    const row = store.operators.get(operatorId);
    expect(row?.email).toBe(UI_NEXT_DEV_OPERATOR_EMAIL);
    expect(row?.name).toBe(UI_NEXT_DEV_OPERATOR_NAME);

    const op = await authenticateOperator(
      store,
      UI_NEXT_DEV_OPERATOR.email,
      UI_NEXT_DEV_OPERATOR_PASSWORD,
    );
    expect(op).not.toBeNull();
    expect(op!.id).toBe(operatorId);
    expect(op!.email).toBe(UI_NEXT_DEV_OPERATOR_EMAIL);
  });
});
