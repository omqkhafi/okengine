/**
 * Inline text editor for an editable table cell. Commits on blur or Enter.
 */

import { useEffect, useRef, useState, type JSX } from "react";
import { cn } from "@/lib/utils.ts";

/** Props for {@link EditableCell}. */
export interface EditableCellProps {
  readonly value: string;
  readonly label: string;
  readonly onChange: (next: string) => void;
  readonly onFocus?: () => void;
  readonly onIdle?: () => void;
  readonly dirty?: boolean;
  readonly autoFocus?: boolean;
  readonly placeholder?: string;
  readonly className?: string;
}

/**
 * Click-to-edit input. Escape reverts; Enter / blur commit to the pending layer.
 *
 * @param props - Current value + commit handler
 */
export function EditableCell({
  value,
  label,
  onChange,
  onFocus,
  onIdle,
  dirty = false,
  autoFocus = false,
  placeholder = "Empty",
  className,
}: EditableCellProps): JSX.Element {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!autoFocus) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [autoFocus]);

  const commit = () => {
    if (draft !== value) onChange(draft);
  };

  const finish = () => {
    commit();
    onIdle?.();
  };

  return (
    <input
      ref={inputRef}
      value={draft}
      aria-label={label}
      size={1}
      data-dirty={dirty ? "true" : undefined}
      onFocus={onFocus}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          finish();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(value);
          onIdle?.();
          e.currentTarget.blur();
        }
      }}
      placeholder={placeholder}
      className={cn(
        "h-full w-full min-w-0 appearance-none rounded-none border-0 bg-transparent p-0",
        "shadow-none outline-none ring-0",
        "focus:bg-transparent focus:shadow-none focus:ring-0 focus:outline-none",
        "focus-visible:shadow-none focus-visible:ring-0 focus-visible:outline-none",
        "placeholder:text-muted-foreground/40",
        dirty ? "text-[#9a5b12] dark:text-[#e8c48a]" : "text-foreground",
        className,
      )}
    />
  );
}
