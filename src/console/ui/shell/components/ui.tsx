/**
 * Minimal shadcn-style primitives on Base UI — owned, trimmed copy.
 */

import { Button as BaseButton } from "@base-ui/react/button";
import { Input as BaseInput } from "@base-ui/react/input";
import { clsx } from "clsx";
import type { ComponentProps, ReactNode } from "react";

/** Button variants. */
export type ButtonVariant = "primary" | "ghost" | "danger";

/**
 * Console button.
 *
 * @param props - Base UI button props + variant
 */
export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof BaseButton> & { readonly variant?: ButtonVariant }) {
  return (
    <BaseButton
      className={clsx(
        "inline-flex min-h-8 items-center justify-center px-3 text-sm font-medium transition-opacity duration-150",
        "disabled:opacity-40",
        variant === "primary" && "bg-[var(--oke-accent)] text-black",
        variant === "ghost" && "bg-transparent text-[var(--oke-fg)] border border-[var(--oke-line)]",
        variant === "danger" && "bg-[var(--oke-danger)] text-white",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Text field.
 *
 * @param props - Input props
 */
export function Input({
  className,
  ...props
}: ComponentProps<typeof BaseInput>) {
  return (
    <BaseInput
      className={clsx(
        "min-h-8 w-full border border-[var(--oke-line)] bg-transparent px-3 text-sm text-[var(--oke-fg)]",
        "placeholder:text-[var(--oke-muted)]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Field label + control.
 *
 * @param props - Label text and children
 */
export function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-[var(--oke-muted)]">{label}</span>
      {children}
    </label>
  );
}
