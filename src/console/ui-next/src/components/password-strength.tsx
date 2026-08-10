/**
 * Live password policy meter — progress + interactive checklist.
 * Rules match {@link CONSOLE_PASSWORD_POLICY} (shared with the claim flow).
 */

import { CheckmarkCircle02Icon, CircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  evaluateConsolePasswordRules,
  type ConsolePasswordRule,
} from "@console/password-policy";
import { cn } from "@/lib/utils";

/** Single password rule used for checklist + progress. */
export type PasswordRule = ConsolePasswordRule;

/**
 * Evaluate claim/operator password policy against plaintext.
 *
 * @param password - Current password value
 */
export function evaluatePasswordRules(password: string): readonly PasswordRule[] {
  return evaluateConsolePasswordRules(password);
}

type StrengthTone = {
  readonly label: string;
  readonly bar: string;
  readonly text: string;
};

/**
 * Map met-rule count to a readable tone (independent of theme primary,
 * which is near-white in dark mode and washes out mid progress).
 *
 * @param metCount - Rules satisfied
 * @param total - Total rules
 */
function strengthTone(metCount: number, total: number): StrengthTone {
  if (metCount <= 0) {
    return {
      label: "Empty",
      bar: "bg-muted-foreground/35",
      text: "text-muted-foreground",
    };
  }
  if (metCount === total) {
    return {
      label: "Strong",
      bar: "bg-emerald-500",
      text: "text-emerald-600 dark:text-emerald-400",
    };
  }
  const ratio = metCount / total;
  if (ratio <= 0.4) {
    return {
      label: "Weak",
      bar: "bg-destructive",
      text: "text-destructive",
    };
  }
  if (ratio <= 0.6) {
    return {
      label: "Fair",
      bar: "bg-amber-500",
      text: "text-amber-600 dark:text-amber-400",
    };
  }
  return {
    label: "Good",
    bar: "bg-lime-500",
    text: "text-lime-700 dark:text-lime-400",
  };
}

type PasswordStrengthProps = {
  /** Current password value */
  password: string;
  /** Optional id for aria-describedby targets */
  id?: string;
};

/**
 * Progress bar + checklist that update as the password is typed.
 *
 * @param props - Password value and optional element id
 */
export function PasswordStrength({ password, id = "password-strength" }: PasswordStrengthProps) {
  const rules = evaluatePasswordRules(password);
  const metCount = rules.filter((rule) => rule.met).length;
  const value = Math.round((metCount / rules.length) * 100);
  const tone = strengthTone(metCount, rules.length);
  const empty = password.length === 0;

  return (
    <div id={id} className="flex flex-col gap-3" aria-live="polite">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground" id={`${id}-label`}>
            Password strength
          </p>
          <p
            className={cn("text-xs tabular-nums font-medium", empty ? "text-muted-foreground" : tone.text)}
            aria-hidden
          >
            {empty ? `0/${rules.length}` : `${tone.label} · ${metCount}/${rules.length}`}
          </p>
        </div>
        <div
          role="progressbar"
          aria-labelledby={`${id}-label`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
          aria-valuetext={
            empty
              ? "No password entered"
              : `${tone.label}: ${metCount} of ${rules.length} requirements met`
          }
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width,background-color] duration-200 ease-out",
              empty ? "bg-muted-foreground/35" : tone.bar,
            )}
            style={{ width: `${empty ? 0 : Math.max(value, metCount > 0 ? 12 : 0)}%` }}
          />
        </div>
      </div>

      <ul className="flex flex-col gap-1.5" aria-label="Password requirements">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className={cn(
              "flex items-center gap-2 text-xs transition-colors",
              rule.met ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <HugeiconsIcon
              icon={rule.met ? CheckmarkCircle02Icon : CircleIcon}
              size={14}
              color="currentColor"
              strokeWidth={1.5}
              className={cn(
                rule.met
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground/60",
              )}
              aria-hidden
            />
            <span>
              <span className="sr-only">{rule.met ? "Met: " : "Not met: "}</span>
              {rule.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
