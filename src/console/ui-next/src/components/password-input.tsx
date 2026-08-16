/**
 * Password input with show/hide toggle — type remount + a11y announcements.
 */

import { ViewIcon, ViewOffSlashIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useId, useState, type ComponentProps } from "react";
import { EXPLORER_ICON_BUTTON_BARE_CLASS } from "@/components/explorer/explorer-chrome.ts";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<ComponentProps<"input">, "type"> & {
  /** Increment after generate so the value is shown (operator can hide again). */
  revealNonce?: number;
};

/**
 * Text field that toggles between `password` and `text` input types.
 *
 * @param props - Standard input props (`type` is owned by this control)
 */
export function PasswordInput({ className, id, revealNonce, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (revealNonce !== undefined && revealNonce > 0) setVisible(true);
  }, [revealNonce]);
  const reactId = useId();
  const inputId = id ?? `password-${reactId}`;
  const statusId = `${inputId}-visibility`;
  const inputType = visible ? "text" : "password";

  return (
    <div className="relative w-full min-w-0">
      <Input
        key={inputType}
        {...props}
        id={inputId}
        type={inputType}
        inputMode="text"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        aria-controls={inputId}
        aria-describedby={statusId}
        className={cn(EXPLORER_ICON_BUTTON_BARE_CLASS, "absolute top-1/2 right-0 -translate-y-1/2")}
      >
        <HugeiconsIcon
          icon={visible ? ViewOffSlashIcon : ViewIcon}
          size={16}
          color="currentColor"
          strokeWidth={1.5}
          aria-hidden
        />
      </button>
      <span id={statusId} className="sr-only" aria-live="polite">
        {visible ? "Password is visible" : "Password is hidden"}
      </span>
    </div>
  );
}
