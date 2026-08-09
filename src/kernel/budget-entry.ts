/**
 * Bundle entry for the kernel edge size budget (AGENTS.md / unified-theory §24).
 *
 * Anchors the tree-shaken edge profile — router, flow binding, fx, hooks,
 * capability, contracts — without optional elements (runs, boot, drivers).
 * Live bindings keep minify from dropping the runtime graph.
 */

import { compileRoute, encodeExecuteResult } from "../compiler/index.ts";
import { validate } from "../validation/standard-schema.ts";
import { createCapabilityToken } from "./capability.ts";
import { fail, OKE_ERRORS } from "./errors.ts";
import { flow } from "./flow.ts";
import { createFx } from "./fx.ts";
import { mergeHooks, runPipeline } from "./hooks.ts";
import { on, resetBindings } from "./on.ts";
import { createEdgeRouter as createRouter } from "./router/create-edge.ts";
import { http } from "./triggers.ts";

/**
 * Anchor for the size check — must reference the edge-profile surface.
 */
export function __okeKernelBudgetAnchor(): {
  createRouter: typeof createRouter;
  flow: typeof flow;
  on: typeof on;
  resetBindings: typeof resetBindings;
  http: typeof http;
  createFx: typeof createFx;
  fail: typeof fail;
  OKE_ERRORS: typeof OKE_ERRORS;
  runPipeline: typeof runPipeline;
  mergeHooks: typeof mergeHooks;
  createCapabilityToken: typeof createCapabilityToken;
  compileRoute: typeof compileRoute;
  encodeExecuteResult: typeof encodeExecuteResult;
  validate: typeof validate;
} {
  return {
    createRouter,
    flow,
    on,
    resetBindings,
    http,
    createFx,
    fail,
    OKE_ERRORS,
    runPipeline,
    mergeHooks,
    createCapabilityToken,
    compileRoute,
    encodeExecuteResult,
    validate,
  };
}
