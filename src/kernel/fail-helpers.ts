/**
 * Built-in `fail.notFound` / `fail.forbidden` / … helpers.
 *
 * Kept off the kernel edge graph — loaded via computed `import.meta.require`.
 * Mutates the shared {@link fail} function so `fx.fail` and `import { fail }`
 * share one identity.
 */

import { fail as failImpl, type FailFn, type FailOptions } from "./errors.ts";
import type { BuiltinErrorMap } from "./builtin-errors.ts";

const empty = {};
const helper =
  (code: string) =>
  (data = empty, opts?: FailOptions) =>
    failImpl(code, data, opts);

/**
 * Callable `fail` plus helpers. Same function object as kernel `fail`.
 */
export const fail: FailFn = Object.assign(failImpl, {
  notFound: helper("NotFound"),
  unauthorized: helper("Unauthorized"),
  forbidden: helper("Forbidden"),
  conflict: helper("Conflict"),
  foreignKey: helper("ForeignKey"),
  rateLimited: helper("RateLimited"),
  serviceUnavailable: helper("ServiceUnavailable"),
  database: (data: BuiltinErrorMap["DatabaseError"], opts?: FailOptions) =>
    failImpl("DatabaseError", data, opts),
  internal: helper("InternalError"),
});

export type { FailFn, FailOptions } from "./errors.ts";
