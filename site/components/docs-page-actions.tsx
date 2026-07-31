"use client";

/**
 * Honest docs page actions: Copy Markdown always; Open-in only for
 * publicly documented URL schemes (Cursor). ChatGPT / Claude web have no
 * documented deep-link API — offer copy-prompt instead of fake hrefs.
 */

import { GithubMark } from "@/components/chrome/icons";
import { cn } from "@/lib/cn";
import { buttonVariants } from "fumadocs-ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "fumadocs-ui/components/ui/popover";
import { MarkdownCopyButton } from "fumadocs-ui/layouts/docs/page";
import { Bot, Check, ChevronDown, ExternalLinkIcon, Sparkles, TextIcon } from "lucide-react";
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
 * Copy Markdown + Copy prompt + honest Open menu for a docs page.
 */
export function DocsPageActions({ markdownUrl, githubUrl }: DocsPageActionsProps): ReactNode {
  return (
    <div className="flex flex-row gap-2 items-center border-b pb-6">
      <MarkdownCopyButton markdownUrl={markdownUrl} />
      <CopyPromptButton markdownUrl={markdownUrl} />
      <HonestViewOptions markdownUrl={markdownUrl} githubUrl={githubUrl} />
    </div>
  );
}

function CopyPromptButton({ markdownUrl }: { readonly markdownUrl: string }): ReactNode {
  const [copied, setCopied] = useState(false);

  async function copyPrompt(): Promise<void> {
    await navigator.clipboard.writeText(cursorPromptForMarkdown(markdownUrl));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={() => void copyPrompt()}
      className={cn(buttonVariants({ color: "secondary", size: "sm" }), "gap-2")}
    >
      {copied ? <Check className="size-3.5" /> : <Bot className="size-3.5" />}
      Copy prompt
    </button>
  );
}

function HonestViewOptions({ markdownUrl, githubUrl }: DocsPageActionsProps): ReactNode {
  const items = useMemo(() => {
    const prompt = cursorPromptForMarkdown(markdownUrl);
    return {
      cursorHref: cursorPromptHref(prompt),
      markdownHref: markdownUrl,
      githubHref: githubUrl,
    };
  }, [githubUrl, markdownUrl]);

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
          <MenuLink href={items.githubHref} title="Open in GitHub" icon={<GithubMark />} />
        ) : null}
        <MenuLink href={items.markdownHref} title="View as Markdown" icon={<TextIcon />} />
        <MenuLink href={items.cursorHref} title="Open in Cursor" icon={<Sparkles />} />
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
