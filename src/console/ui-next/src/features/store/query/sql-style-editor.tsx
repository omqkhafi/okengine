/**
 * Compact highlighted SQL editor — transparent textarea over AgentCode.
 */

import { useRef, type JSX, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils.ts";
import { QueryHighlightView } from "./query-highlight-view.tsx";

/** Props for {@link SqlStyleEditor}. */
export interface SqlStyleEditorProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly label: string;
  readonly className?: string;
  readonly onSubmit?: () => void;
}

/**
 * Free SQL editor with keyword colors. ⌘/Ctrl+Enter submits when `onSubmit` is set.
 *
 * @param props - Buffer + label
 */
export function SqlStyleEditor({
  value,
  onChange,
  label,
  className,
  onSubmit,
}: SqlStyleEditorProps): JSX.Element {
  const highRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const highlight = value.endsWith("\n") ? value : `${value}\n`;

  const syncScroll = (): void => {
    const area = areaRef.current;
    const high = highRef.current;
    if (!area || !high) return;
    high.scrollTop = area.scrollTop;
    high.scrollLeft = area.scrollLeft;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (onSubmit && (event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className={cn("relative min-h-56 bg-muted/15", className)}>
      <div ref={highRef} className="pointer-events-none absolute inset-0 overflow-hidden">
        <QueryHighlightView
          code={highlight}
          language="sql"
          className="overflow-visible whitespace-pre-wrap break-words px-4 py-3 text-[11px] leading-5"
        />
      </div>
      <textarea
        ref={areaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={syncScroll}
        onKeyDown={onKeyDown}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        aria-label={label}
        data-slot="sql-style-editor"
        className="absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent px-4 py-3 font-mono text-[11px] leading-5 break-words whitespace-pre-wrap text-transparent caret-foreground outline-none"
      />
    </div>
  );
}
