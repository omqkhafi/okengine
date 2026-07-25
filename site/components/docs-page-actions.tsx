"use client";

/**
 * Honest docs page actions: Copy Markdown always; Open-in only for
 * publicly documented URL schemes (Cursor). ChatGPT / Claude web have no
 * documented deep-link API — offer copy-prompt instead of fake hrefs.
 */

import { cn } from "@/lib/cn";
import { buttonVariants } from "fumadocs-ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "fumadocs-ui/components/ui/popover";
import { MarkdownCopyButton } from "fumadocs-ui/layouts/docs/page";
import { Check, ChevronDown, Copy, ExternalLinkIcon, TextIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

export interface DocsPageActionsProps {
  /** Absolute or site-relative markdown URL for this page. */
  readonly markdownUrl: string;
  /** GitHub blob URL for the canonical source file. */
  readonly githubUrl?: string;
}

/**
 * Build a short Cursor prompt that points at the markdown URL.
 *
 * @param markdownUrl - Per-page markdown URL (may be site-relative)
 */
export function cursorPromptForMarkdown(markdownUrl: string): string {
  const absolute =
    typeof window !== "undefined" && markdownUrl.startsWith("/")
      ? new URL(markdownUrl, window.location.origin).href
      : markdownUrl;
  return `Read ${absolute}, I want to ask questions about it.`;
}

/**
 * Documented Cursor deeplink that prefills a prompt.
 *
 * @param text - Prompt text
 * @see https://cursor.com/docs/reference/deeplinks
 */
export function cursorPromptHref(text: string): string {
  return `https://cursor.com/link/prompt?${new URLSearchParams({ text })}`;
}

/**
 * Copy Markdown + honest Open menu for a docs page.
 */
export function DocsPageActions({
  markdownUrl,
  githubUrl,
}: DocsPageActionsProps): ReactNode {
  return (
    <div className="flex flex-row gap-2 items-center border-b pb-6">
      <MarkdownCopyButton markdownUrl={markdownUrl} />
      <HonestViewOptions markdownUrl={markdownUrl} githubUrl={githubUrl} />
    </div>
  );
}

function HonestViewOptions({
  markdownUrl,
  githubUrl,
}: DocsPageActionsProps): ReactNode {
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const items = useMemo(() => {
    const prompt = cursorPromptForMarkdown(markdownUrl);
    return {
      prompt,
      cursorHref: cursorPromptHref(prompt),
      markdownHref: markdownUrl,
      githubHref: githubUrl,
    };
  }, [githubUrl, markdownUrl]);

  async function copyAssistantPrompt(): Promise<void> {
    await navigator.clipboard.writeText(items.prompt);
    setCopiedPrompt(true);
    window.setTimeout(() => setCopiedPrompt(false), 1500);
  }

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          buttonVariants({
            color: "secondary",
            size: "sm",
          }),
          "gap-2 data-[popup-open]:bg-fd-accent data-[popup-open]:text-fd-accent-foreground",
        )}
      >
        Open
        <ChevronDown className="size-3.5 text-fd-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="flex flex-col min-w-56">
        {items.githubHref ? (
          <MenuLink href={items.githubHref} title="Open in GitHub" />
        ) : null}
        <MenuLink href={items.markdownHref} title="View as Markdown" icon={<TextIcon />} />
        <MenuLink href={items.cursorHref} title="Open in Cursor" />
        <button
          type="button"
          onClick={() => void copyAssistantPrompt()}
          className="text-sm p-2 rounded-lg inline-flex items-center gap-2 hover:text-fd-accent-foreground hover:bg-fd-accent [&_svg]:size-4 text-left"
        >
          {copiedPrompt ? <Check /> : <Copy />}
          Copy prompt for ChatGPT / Claude
        </button>
      </PopoverContent>
    </Popover>
  );
}

function MenuLink({
  href,
  title,
  icon,
}: {
  readonly href: string;
  readonly title: string;
  readonly icon?: ReactNode;
}): ReactNode {
  return (
    <a
      href={href}
      rel="noreferrer noopener"
      target="_blank"
      className="text-sm p-2 rounded-lg inline-flex items-center gap-2 hover:text-fd-accent-foreground hover:bg-fd-accent [&_svg]:size-4"
    >
      {icon}
      {title}
      <ExternalLinkIcon className="text-fd-muted-foreground size-3.5 ms-auto" />
    </a>
  );
}
