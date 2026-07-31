/**
 * Homepage-only: copy a project-wide AI onboarding prompt (llms.txt + AGENTS.md).
 * Distinct from per-page DocsPageActions copy-prompt.
 */

"use client";

import { Check, Bot } from "lucide-react";
import { useState, type ReactNode } from "react";
import { agentOnboardPrompt } from "@/lib/agent-onboard";

/**
 * Copy-to-clipboard control for the hero CTA row.
 */
export function AiOnboardButton(): ReactNode {
  const [copied, setCopied] = useState(false);

  async function copyPrompt(): Promise<void> {
    const origin = typeof window !== "undefined" ? window.location.origin : undefined;
    await navigator.clipboard.writeText(agentOnboardPrompt(origin));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={() => void copyPrompt()}
      className="group relative inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-medium text-fd-muted-foreground transition-colors hover:text-fd-foreground sm:text-sm"
      aria-label="Copy AI onboarding prompt"
    >
      <span
        className="absolute inset-0 opacity-[0.04] transition-opacity group-hover:opacity-[0.08]"
        style={{
          backgroundImage: `repeating-linear-gradient(
            -45deg,
            transparent,
            transparent 4px,
            currentColor 4px,
            currentColor 5px
          )`,
        }}
      />
      <span className="absolute top-0 -right-[6px] -left-[6px] h-px bg-fd-foreground/20 transition-colors group-hover:bg-fd-foreground/30" />
      <span className="absolute bottom-0 -right-[6px] -left-[6px] h-px bg-fd-foreground/20 transition-colors group-hover:bg-fd-foreground/30" />
      <span className="absolute -top-[6px] -bottom-[6px] left-0 w-px bg-fd-foreground/20 transition-colors group-hover:bg-fd-foreground/30" />
      <span className="absolute -top-[6px] -bottom-[6px] right-0 w-px bg-fd-foreground/20 transition-colors group-hover:bg-fd-foreground/30" />
      {copied ? (
        <Check className="relative size-3.5" aria-hidden />
      ) : (
        <Bot className="relative size-3.5" aria-hidden />
      )}
      <span className="relative">{copied ? "Copied" : "Onboard an AI"}</span>
    </button>
  );
}
