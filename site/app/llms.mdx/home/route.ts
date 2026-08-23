import { homepageMarkdownResponse } from "@/lib/home-markdown";

export const revalidate = false;

/**
 * Markdown twin of `/` — rewrite target for `Accept: text/markdown`.
 */
export function GET() {
  return homepageMarkdownResponse();
}
