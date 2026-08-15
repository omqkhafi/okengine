import { buildLlmsCatalog } from "@/lib/llms-index";

export const revalidate = false;

export function GET() {
  return Response.json(buildLlmsCatalog(), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
