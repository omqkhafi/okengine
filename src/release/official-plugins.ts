/**
 * Official `okengine/plugins` named exports measured for CI budgets.
 * Categories match `site/content/docs/plugins/index.mdx`.
 * Keep in sync with the docs catalogue — landing + budgets both read this.
 */

/** Docs / landing category for an official plugin. */
export type PluginBudgetCategory = "auth" | "security" | "ops" | "perf";

/** One official plugin entry measured as `export:./plugins/<name>`. */
export type OfficialPluginBudget = {
  /** Named export from `okengine/plugins`. */
  readonly name: string;
  /** Basename under `src/plugins/` (e.g. `magic-link.ts`). */
  readonly file: string;
  /** Docs category. */
  readonly category: PluginBudgetCategory;
};

/** Category display order (docs index). */
export const PLUGIN_BUDGET_CATEGORIES: readonly PluginBudgetCategory[] = [
  "auth",
  "security",
  "ops",
  "perf",
] as const;

/**
 * Canonical official plugins — membership, file mapping, and grouping.
 * Order within a category is docs order; landing may re-sort by size.
 */
export const OFFICIAL_PLUGIN_BUDGETS: readonly OfficialPluginBudget[] = [
  { name: "username", file: "username.ts", category: "auth" },
  { name: "anonymous", file: "anonymous.ts", category: "auth" },
  { name: "magicLink", file: "magic-link.ts", category: "auth" },
  { name: "emailOtp", file: "email-otp.ts", category: "auth" },
  { name: "phoneNumber", file: "phone-number.ts", category: "auth" },
  { name: "twoFactor", file: "two-factor.ts", category: "auth" },
  { name: "passkey", file: "passkey.ts", category: "auth" },
  { name: "headers", file: "headers.ts", category: "security" },
  { name: "cors", file: "cors.ts", category: "security" },
  { name: "csrf", file: "csrf.ts", category: "security" },
  { name: "ipAllowlist", file: "ip-allowlist.ts", category: "security" },
  { name: "maintenanceMode", file: "maintenance-mode.ts", category: "ops" },
  { name: "compression", file: "compression.ts", category: "perf" },
] as const;
