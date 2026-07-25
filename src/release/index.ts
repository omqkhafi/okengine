/**
 * Release engineering — budgets, snapshots, published numbers.
 */

export {
  CLIENT_BUDGET_BYTES,
  COLD_START_BUDGET_MS,
  CONSOLE_BUDGET_BYTES,
  KERNEL_EDGE_BUDGET_BYTES,
  ROUTING_P99_BUDGET_MS,
} from "./limits.ts";

export {
  budgetsPass,
  formatBudgetsReport,
  measureAllBudgets,
  measureClientGzipBytes,
  measureColdStartMedianMs,
  measureConsoleInitialGzipBytes,
  measureKernelEdgeGzipBytes,
  measureRoutingP99Ms,
  type BudgetSample,
  type BudgetsSnapshot,
} from "./measure.ts";

export {
  BUDGETS_JSON,
  publishBudgets,
  type PublishBudgetsOptions,
} from "./publish.ts";
