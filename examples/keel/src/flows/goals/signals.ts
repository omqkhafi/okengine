import { signal } from "okengine";
import { z } from "zod";

const GoalRef = z.object({
  goalId: z.string(),
  name: z.string(),
  status: z.string(),
});

/** Goal health dropped to at-risk — exclusive mail. */
export const goalAtRisk = signal.once("goal-at-risk", {
  retries: 3,
  deadLetter: true,
  schema: GoalRef,
});

/** Goal changed — fan-out (ops inbox). */
export const goalChanged = signal.broadcast("goal-changed", {
  retries: 3,
  deadLetter: true,
  schema: GoalRef,
});

/** Goal health — live rollup a late subscriber can replay. */
export const goalHealth = signal.live("goal-health", { optional: true, schema: GoalRef });
