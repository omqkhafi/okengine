/**
 * Resolve-form checks and lease retries for the decisions page.
 */

/** One question the form can answer. */
export interface DecisionFormQuestion {
  readonly id: string;
  readonly kind: "boolean" | "choice" | "score";
  readonly options?: readonly string[];
  readonly levels?: readonly string[];
}

/** Result of one resolve POST. */
export interface DecisionResolveResult {
  readonly error?: { readonly code: string };
  readonly data?: { readonly ok: true };
}

/**
 * True when every open question has a value inside its options or levels.
 *
 * @param questions - Open questions from the queue row
 * @param values - Form values
 */
export function decisionValuesValid(
  questions: readonly DecisionFormQuestion[],
  values: Readonly<Record<string, unknown>>,
): boolean {
  if (Object.keys(values).length !== questions.length) return false;
  for (const question of questions) {
    const value = values[question.id];
    if (question.kind === "boolean") {
      if (typeof value !== "boolean") return false;
      continue;
    }
    if (typeof value !== "string") return false;
    if (question.kind === "choice") {
      if (!question.options?.includes(value)) return false;
      continue;
    }
    if (!question.levels?.includes(value)) return false;
  }
  return true;
}

/**
 * POST a resolve, retrying `JournalLeaseBusy`. `Conflict` returns immediately.
 *
 * @param post - Resolve client
 * @param body - Review id and values
 * @param attempts - How many times to try
 */
export async function resolveDecisionWithRetry(
  post: (body: {
    readonly id: string;
    readonly values: Readonly<Record<string, unknown>>;
    readonly labelOnly?: boolean;
  }) => Promise<DecisionResolveResult>,
  body: {
    readonly id: string;
    readonly values: Readonly<Record<string, unknown>>;
    readonly labelOnly?: boolean;
  },
  attempts = 5,
): Promise<DecisionResolveResult> {
  let last: DecisionResolveResult = {};
  for (let i = 0; i < attempts; i++) {
    last = await post(body);
    if (last.error?.code !== "JournalLeaseBusy") return last;
  }
  return last;
}

/** Label shown for a list state. */
export function decisionStateLabel(
  state: "learning" | "candidate" | "certified" | "suspended",
): string {
  if (state === "candidate") return "candidate ready";
  return state;
}
