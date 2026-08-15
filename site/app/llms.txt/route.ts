import { buildLlmsTxt } from "@/lib/llms-index";

export const revalidate = false;

export function GET() {
  return new Response(buildLlmsTxt(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}
