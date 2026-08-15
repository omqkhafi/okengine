import { signal } from "okengine";
import { z } from "zod";

const FormRef = z.object({
  formId: z.string(),
  taskId: z.string(),
  customerName: z.string(),
});

/** Form submitted — intake mail + inbox (exactly one worker). */
export const formSubmitted = signal("form-submitted", {
  delivery: "once",
  retries: 5,
  deadLetter: true,
  schema: FormRef,
});

/** Form changed — fan-out (index the created task). */
export const formChanged = signal("form-changed", {
  delivery: "broadcast",
  retries: 3,
  deadLetter: true,
  schema: FormRef,
});

/** Form intake — live feed a late subscriber can replay. */
export const formIntake = signal("form-intake", {
  delivery: "live",
  optional: true,
  schema: FormRef,
});
