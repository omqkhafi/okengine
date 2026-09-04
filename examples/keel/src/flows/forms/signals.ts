import { signal } from "okengine";
import { z } from "zod";

const FormRef = z.object({
  formId: z.string(),
  taskId: z.string(),
  customerName: z.string(),
});

/** Form submitted — intake mail + inbox (exactly one worker). */
export const formSubmitted = signal.once("form-submitted", {
  retries: 5,
  deadLetter: true,
  schema: FormRef,
});

/** Form changed — fan-out (index the created task). */
export const formChanged = signal.broadcast("form-changed", {
  retries: 3,
  deadLetter: true,
  schema: FormRef,
});

/** Form intake — live feed a late subscriber can replay. */
export const formIntake = signal.live("form-intake", { optional: true, schema: FormRef });
