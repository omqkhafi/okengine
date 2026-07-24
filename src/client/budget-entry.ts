/**
 * Bundle entry for the client size budget.
 * Returns live bindings so minify cannot drop the runtime graph.
 */

import { createClient } from "./create.ts";
import {
  isErrorCode,
  isFail,
  isOk,
  isTransportError,
} from "./errors.ts";
import { createTransport } from "./transport.ts";

/**
 * Anchor for the size check — must reference every runtime export.
 */
export function __okeClientBudgetAnchor(): {
  createClient: typeof createClient;
  createTransport: typeof createTransport;
  isErrorCode: typeof isErrorCode;
  isFail: typeof isFail;
  isOk: typeof isOk;
  isTransportError: typeof isTransportError;
} {
  return {
    createClient,
    createTransport,
    isErrorCode,
    isFail,
    isOk,
    isTransportError,
  };
}
