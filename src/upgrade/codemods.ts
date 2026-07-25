/**
 * Versioned codemod registry — ships with every breaking change (§22).
 *
 * `oke upgrade` runs every applicable transform and prints a diff.
 * Adding a breaking change without a codemod is a process defect; the
 * registry is the checklist.
 */

/** One file rewrite produced by a codemod. */
export interface CodemodChange {
  /** Path relative to the project root. */
  readonly path: string;
  /** Original file contents. */
  readonly before: string;
  /** Transformed file contents. */
  readonly after: string;
}

/** One registered breaking-change transform. */
export interface Codemod {
  /** Stable id (e.g. `0.1.0-rename-fx-ask`). */
  readonly id: string;
  /** Semver range this applies when upgrading from. */
  readonly from: string;
  /** Semver this lands in. */
  readonly to: string;
  /** One-line description for `oke upgrade` output. */
  readonly description: string;
  /**
   * Apply the transform.
   *
   * @param cwd - Project root
   */
  readonly apply: (cwd: string) => Promise<readonly CodemodChange[]>;
}

/**
 * Built-in transforms. Empty until the next intentional breaking release —
 * the infrastructure is the gate; entries are added with the break.
 */
export const CODEMODS: readonly Codemod[] = [];

/**
 * Validate the registry (unique ids, non-empty metadata, apply present).
 *
 * @param registry - Codemods to validate (defaults to {@link CODEMODS})
 */
export function validateCodemodRegistry(
  registry: readonly Codemod[] = CODEMODS,
): readonly string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const mod of registry) {
    if (!mod.id.trim()) errors.push("codemod missing id");
    else if (seen.has(mod.id)) errors.push(`duplicate codemod id: ${mod.id}`);
    else seen.add(mod.id);
    if (!mod.from.trim()) errors.push(`${mod.id}: missing from`);
    if (!mod.to.trim()) errors.push(`${mod.id}: missing to`);
    if (!mod.description.trim()) errors.push(`${mod.id}: missing description`);
    if (typeof mod.apply !== "function") {
      errors.push(`${mod.id}: apply must be a function`);
    }
  }
  return errors;
}

/**
 * Run every registered codemod and collect file rewrites.
 *
 * @param cwd - Project root
 * @param registry - Codemods (defaults to {@link CODEMODS})
 */
export async function runCodemods(
  cwd: string,
  registry: readonly Codemod[] = CODEMODS,
): Promise<readonly CodemodChange[]> {
  const out: CodemodChange[] = [];
  for (const mod of registry) {
    const changes = await mod.apply(cwd);
    out.push(...changes);
  }
  return out;
}
