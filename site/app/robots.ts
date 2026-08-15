import { DOCS_ORIGIN } from "@/lib/agent-onboard";
import type { MetadataRoute } from "next";

export const revalidate = false;

/**
 * Allow every crawler — including named AI training and user-fetch bots —
 * and point them at the sitemap. This is a public handbook.
 */
export default function robots(): MetadataRoute.Robots {
  const allowAll = { allow: "/" } as const;
  return {
    rules: [
      { userAgent: "*", ...allowAll },
      { userAgent: "GPTBot", ...allowAll },
      { userAgent: "ChatGPT-User", ...allowAll },
      { userAgent: "OAI-SearchBot", ...allowAll },
      { userAgent: "ClaudeBot", ...allowAll },
      { userAgent: "Claude-User", ...allowAll },
      { userAgent: "Claude-SearchBot", ...allowAll },
      { userAgent: "PerplexityBot", ...allowAll },
      { userAgent: "Google-Extended", ...allowAll },
      { userAgent: "Applebot-Extended", ...allowAll },
    ],
    sitemap: `${DOCS_ORIGIN}/sitemap.xml`,
    host: DOCS_ORIGIN,
  };
}
