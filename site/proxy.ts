/**
 * Request-time markdown negotiation. `output: "export"` cannot run this file,
 * so production is a Next.js server (Vercel) rather than a static `out/` tree.
 */

import { markdownNegotiation, markdownTwinPath } from "@/lib/markdown-negotiate";
import { markdownNotFoundResponse } from "@/lib/not-found-markdown";
import { type NextRequest, NextResponse } from "next/server";

/**
 * When Accept prefers markdown, rewrite handbook URLs to their twins and 404
 * unknown paths with a markdown body. Always stamp `Vary: Accept` on those
 * responses so caches key the representation they selected.
 *
 * @param request - Incoming request
 */
export function proxy(request: NextRequest): NextResponse | Response {
  const action = markdownNegotiation(request);
  if (action.kind === "pass") {
    const response = NextResponse.next();
    if (markdownTwinPath(request.nextUrl.pathname) !== undefined) {
      response.headers.set("Vary", "Accept");
    }
    return response;
  }

  if (action.kind === "not-found") {
    const body = markdownNotFoundResponse();
    return new NextResponse(body.body, {
      status: 404,
      headers: body.headers,
    });
  }

  const url = request.nextUrl.clone();
  url.pathname = action.pathname;
  const response = NextResponse.rewrite(url);
  response.headers.set("Vary", "Accept");
  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|og/|llms|icon\\.svg|favicon.ico|.*\\.png$|.*\\.svg$|.*\\.woff2$).*)",
  ],
};
