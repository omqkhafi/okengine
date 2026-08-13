/**
 * Fixed console-next operator for local DX — seeded on every
 * `dev:console-next` / `:seed` boot unless `OKE_CONSOLE_NEXT_FRESH=1`.
 *
 * Credentials are intentional and public for local/dev only; never use in prod.
 */

import { createOperator, createOperatorStore, type OperatorStore } from "../../auth/operator.ts";
import { CONSOLE_PASSWORD_POLICY } from "../password-policy.ts";

/** Stable email for the console-next dev operator. */
export const UI_NEXT_DEV_OPERATOR_EMAIL = "dev@oke.dev";

/** Display name for the console-next dev operator. */
export const UI_NEXT_DEV_OPERATOR_NAME = "Ali Alnaghmoush";

/** Password for the console-next dev operator (meets Console policy). */
export const UI_NEXT_DEV_OPERATOR_PASSWORD = "Okengine123!";

/** Public shape injected into the Vite SPA for login prefill. */
export type UiNextDevOperatorCreds = {
  readonly email: string;
  readonly password: string;
};

/**
 * Credentials object shared by the Vite banner, `define`, and login prefill.
 */
export const UI_NEXT_DEV_OPERATOR: UiNextDevOperatorCreds = {
  email: UI_NEXT_DEV_OPERATOR_EMAIL,
  password: UI_NEXT_DEV_OPERATOR_PASSWORD,
};

/**
 * True when `OKE_CONSOLE_NEXT_FRESH=1` — skip the fixed operator and keep claim open.
 */
export function isConsoleNextFresh(): boolean {
  return process.env["OKE_CONSOLE_NEXT_FRESH"] === "1";
}

/**
 * Create an {@link OperatorStore} with the fixed console-next dev operator.
 * Closing setup (`setupClosed`) follows from `operators.size > 0`.
 *
 * @param store - Optional existing store (defaults to a new empty store)
 */
export async function seedUiNextDevOperator(
  store: OperatorStore = createOperatorStore(),
): Promise<{ readonly store: OperatorStore; readonly operatorId: string }> {
  const op = await createOperator(store, {
    email: UI_NEXT_DEV_OPERATOR_EMAIL,
    name: UI_NEXT_DEV_OPERATOR_NAME,
    password: UI_NEXT_DEV_OPERATOR_PASSWORD,
    passwordPolicy: CONSOLE_PASSWORD_POLICY,
  });
  return { store, operatorId: op.id };
}
