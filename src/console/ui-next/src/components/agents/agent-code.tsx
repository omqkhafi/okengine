/**
 * Shiki token highlighter for agent code surfaces (beUI File Diff).
 *
 * @see https://beui.dev/components/agents/file-diff
 */

import { type CSSProperties, Fragment, useEffect, useState, type JSX } from "react";
import { createHighlighter, type Highlighter } from "shiki/bundle/web";
import { cn } from "@/lib/utils.ts";

/** Languages File Diff can highlight. */
export type AgentCodeLanguage = "bash" | "diff" | "json" | "sql" | "text" | "tsx" | "typescript";

/** One highlighted token. */
export interface AgentCodeToken {
  readonly content: string;
  readonly offset: number;
  readonly light?: string;
  readonly dark?: string;
}

/** Token lines for one highlighted document. */
export type AgentCodeTokenLines = AgentCodeToken[][];

/** Props for {@link AgentCode}. */
export interface AgentCodeProps {
  readonly code: string;
  readonly language?: AgentCodeLanguage;
  readonly className?: string;
}

/** Props for {@link AgentCodeLine}. */
export interface AgentCodeLineProps {
  readonly code: string;
  readonly tokens?: AgentCodeToken[];
  readonly className?: string;
}

const LIGHT_THEME = "github-light-high-contrast";
const DARK_THEME = "github-dark-high-contrast";
const HIGHLIGHT_LANGS = ["bash", "json", "sql", "tsx", "typescript"] as const;
type HighlightLang = (typeof HIGHLIGHT_LANGS)[number];

function isHighlightLang(language: AgentCodeLanguage): language is HighlightLang {
  return (HIGHLIGHT_LANGS as readonly string[]).includes(language);
}

let agentCodeHighlighter: Promise<Highlighter> | null = null;
const tokenCache = new Map<string, AgentCodeTokenLines>();

function getAgentCodeHighlighter(): Promise<Highlighter> {
  if (!agentCodeHighlighter) {
    agentCodeHighlighter = createHighlighter({
      themes: [LIGHT_THEME, DARK_THEME],
      langs: [...HIGHLIGHT_LANGS],
    });
  }
  return agentCodeHighlighter;
}

function tokenCacheKey(code: string, language: AgentCodeLanguage): string {
  return `${language}\u0000${code}`;
}

/**
 * Highlight `code` into dual-theme token lines. `text` skips Shiki.
 *
 * @param code - Source
 * @param language - Grammar id
 */
export function useAgentCodeTokens(
  code: string,
  language: AgentCodeLanguage,
): AgentCodeTokenLines | null {
  const key = tokenCacheKey(code, language);
  const cached = tokenCache.get(key);
  const [result, setResult] = useState<{
    readonly key: string;
    readonly code: string;
    readonly language: AgentCodeLanguage;
    readonly lines: AgentCodeTokenLines;
  } | null>(cached ? { key, code, language, lines: cached } : null);

  useEffect(() => {
    if (language === "text" || language === "diff" || !isHighlightLang(language)) {
      setResult({ key, code, language, lines: [] });
      return;
    }
    const current = tokenCache.get(key);
    if (current) {
      setResult({ key, code, language, lines: current });
      return;
    }

    let cancelled = false;
    void getAgentCodeHighlighter().then((highlighter) => {
      if (cancelled) return;
      const lines = highlighter
        .codeToTokensWithThemes(code, {
          lang: language,
          themes: {
            light: LIGHT_THEME,
            dark: DARK_THEME,
          },
        })
        .map((line) =>
          line.map((token) => ({
            content: token.content,
            offset: token.offset,
            light: token.variants.light?.color,
            dark: token.variants.dark?.color,
          })),
        );
      tokenCache.set(key, lines);
      setResult({ key, code, language, lines });
    });
    return () => {
      cancelled = true;
    };
  }, [code, key, language]);

  if (result?.key === key) return result.lines.length === 0 ? null : result.lines;
  if (result?.language === language && code.startsWith(result.code)) {
    return result.lines.length === 0 ? null : result.lines;
  }
  return null;
}

/**
 * One highlighted line (or the raw string while tokens load).
 *
 * @param props - Line source + optional tokens
 */
export function AgentCodeLine({ code, tokens, className }: AgentCodeLineProps): JSX.Element {
  return (
    <code className={cn("font-mono text-[inherit]", className)}>
      {tokens
        ? tokens.map((token) => (
            <span
              key={`${token.offset}-${token.content}`}
              style={
                {
                  "--agent-code-light": token.light ?? "currentColor",
                  "--agent-code-dark": token.dark ?? token.light ?? "currentColor",
                } as CSSProperties
              }
              className="text-[var(--agent-code-light)] dark:text-[var(--agent-code-dark)]"
            >
              {token.content}
            </span>
          ))
        : code}
    </code>
  );
}

/**
 * Multi-line highlighted block.
 *
 * @param props - Source + language
 */
export function AgentCode({ code, language = "bash", className }: AgentCodeProps): JSX.Element {
  const tokens = useAgentCodeTokens(code, language);
  let offset = 0;
  const lines = code.split("\n").map((content) => {
    const line = { content, offset };
    offset += content.length + 1;
    return line;
  });

  return (
    <pre
      className={cn(
        "m-0 overflow-x-auto whitespace-pre font-mono text-xs leading-5 text-foreground/85",
        className,
      )}
    >
      {lines.map((line, index) => (
        <Fragment key={`${line.offset}-${line.content}`}>
          <AgentCodeLine code={line.content} tokens={tokens?.[index]} />
          {index < lines.length - 1 ? "\n" : null}
        </Fragment>
      ))}
    </pre>
  );
}
