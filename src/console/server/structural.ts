/**
 * Structural Console edits → reviewable diffs in the working tree.
 *
 * Never applied silently (console §1 · §4 · constitutional rule).
 */

/** A proposed structural change waiting for human git review. */
export interface StructuralProposal {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly diff: string;
  readonly createdAt: number;
  readonly actorId: string;
  readonly reason: string;
}

/** Options for {@link emitStructuralDiff}. */
export interface EmitStructuralDiffOptions {
  readonly cwd: string;
  readonly title: string;
  readonly relativePath: string;
  /** Unified diff body (or proposed file contents as a create-diff). */
  readonly diff: string;
  readonly actorId: string;
  readonly reason: string;
  readonly now?: () => number;
  readonly id?: string;
}

/**
 * Write a structural proposal into `.oke/proposed/` without applying it.
 *
 * @param options - Diff payload + working tree root
 */
export async function emitStructuralDiff(
  options: EmitStructuralDiffOptions,
): Promise<StructuralProposal> {
  const now = options.now ?? (() => Date.now());
  const createdAt = now();
  const id = options.id ?? `prop_${createdAt.toString(36)}_${randomSuffix()}`;
  const dir = `${options.cwd}/.oke/proposed`;
  await Bun.$`mkdir -p ${dir}`.quiet();
  const abs = `${dir}/${id}.diff`;

  const header = [
    `# oke Console structural proposal`,
    `# id: ${id}`,
    `# title: ${options.title}`,
    `# target: ${options.relativePath}`,
    `# actor: ${options.actorId}`,
    `# reason: ${options.reason}`,
    `# createdAt: ${new Date(createdAt).toISOString()}`,
    `# status: proposed — not applied`,
    ``,
  ].join("\n");

  await Bun.write(abs, header + options.diff);

  return {
    id,
    title: options.title,
    path: abs,
    diff: options.diff,
    createdAt,
    actorId: options.actorId,
    reason: options.reason,
  };
}

/**
 * Build a create-file unified diff for a new path.
 *
 * @param relativePath - Path relative to repo root
 * @param contents - Proposed file body
 */
export function createFileDiff(relativePath: string, contents: string): string {
  const lines = contents.split("\n");
  const body = lines.map((l) => `+${l}`).join("\n");
  return [
    `diff --git a/${relativePath} b/${relativePath}`,
    `new file mode 100644`,
    `--- /dev/null`,
    `+++ b/${relativePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    body,
    ``,
  ].join("\n");
}

function randomSuffix(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
