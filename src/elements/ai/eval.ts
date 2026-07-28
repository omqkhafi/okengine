/**
 * Prompt eval sets — regression-gated in CI via `oke eval`.
 */

/** One eval case (JSONL line shape). */
export interface EvalCase {
  readonly id?: string;
  readonly input: unknown;
  readonly expect?: unknown;
  /** Optional predicate name evaluated by the runner. */
  readonly assert?: string;
}

/** Result of evaluating one case. */
export interface EvalCaseResult {
  readonly id: string;
  readonly ok: boolean;
  readonly actual?: unknown;
  readonly expect?: unknown;
  readonly error?: string;
}

/** Result of an eval suite. */
export interface EvalSuiteResult {
  readonly prompt: string;
  readonly version?: number;
  readonly passed: number;
  readonly failed: number;
  readonly results: readonly EvalCaseResult[];
  readonly ok: boolean;
}

/** Options for {@link runPromptEvals}. */
export interface RunPromptEvalsOptions {
  readonly prompt: string;
  readonly version?: number;
  readonly cases: readonly EvalCase[];
  /**
   * Invoke the prompt (usually `aiRuntime.ask`).
   *
   * @param input - Case input
   */
  readonly ask: (input: unknown) => Promise<unknown>;
  /**
   * Optional deep equality (defaults to `JSON.stringify` compare).
   */
  readonly equals?: (actual: unknown, expect: unknown) => boolean;
}

/**
 * Run a prompt eval set. Fails CI when any case fails (`ok === false`).
 *
 * @param options - Cases + ask fn
 */
export async function runPromptEvals(options: RunPromptEvalsOptions): Promise<EvalSuiteResult> {
  const equals = options.equals ?? ((a, b) => JSON.stringify(a) === JSON.stringify(b));
  const results: EvalCaseResult[] = [];

  for (let i = 0; i < options.cases.length; i++) {
    const c = options.cases[i]!;
    const id = c.id ?? `case-${i}`;
    try {
      const actual = await options.ask(c.input);
      if (c.expect !== undefined && !equals(actual, c.expect)) {
        results.push({
          id,
          ok: false,
          actual,
          expect: c.expect,
          error: "expectation mismatch",
        });
      } else {
        results.push({ id, ok: true, actual, expect: c.expect });
      }
    } catch (err) {
      results.push({
        id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  return {
    prompt: options.prompt,
    version: options.version,
    passed,
    failed,
    results,
    ok: failed === 0,
  };
}

/**
 * Parse a JSONL eval file contents into cases.
 *
 * @param text - File text
 */
export function parseEvalJsonl(text: string): EvalCase[] {
  const cases: EvalCase[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    cases.push(JSON.parse(trimmed) as EvalCase);
  }
  return cases;
}
