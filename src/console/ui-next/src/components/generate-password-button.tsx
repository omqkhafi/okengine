/**
 * Claim-form control — mint a policy password and copy it.
 */

import { ShuffleIcon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { generateConsolePassword } from "@console/password-policy";
import { Button } from "@/components/ui/button";

/** Props for {@link GeneratePasswordButton}. */
export interface GeneratePasswordButtonProps {
  /** Receives the generated password (always filled, even if copy fails). */
  readonly onGenerate: (password: string) => void;
  /** Disable while the claim request is in flight. */
  readonly disabled?: boolean;
  /** Clipboard write (tests). */
  readonly copyText?: (text: string) => Promise<void>;
}

/**
 * Generate a Console-policy password, fill the field, and copy it.
 *
 * @param props - Fill callback + optional clipboard seam
 */
export function GeneratePasswordButton({
  onGenerate,
  disabled,
  copyText = async (text) => {
    await navigator.clipboard.writeText(text);
  },
}: GeneratePasswordButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      disabled={disabled}
      data-slot="generate-password"
      aria-label={copied ? "Password generated and copied" : "Generate a password and copy it"}
      className="text-muted-foreground"
      onClick={() => {
        const password = generateConsolePassword();
        onGenerate(password);
        void copyText(password)
          .then(() => {
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), 1600);
          })
          .catch(() => {
            setCopied(false);
          });
      }}
    >
      <HugeiconsIcon
        icon={copied ? Tick02Icon : ShuffleIcon}
        data-icon="inline-start"
        color="currentColor"
        strokeWidth={1.5}
        aria-hidden
      />
      {copied ? "Copied" : "Generate"}
    </Button>
  );
}
