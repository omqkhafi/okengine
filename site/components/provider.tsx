"use client";
import SearchDialog from "@/components/search";
import { RootProvider } from "@fumadocs/base-ui/provider/next";
import { type ReactNode } from "react";

/**
 * Site-wide Fumadocs provider (search + next-themes).
 *
 * React 19 warns when a client component renders `<script>`. next-themes
 * injects a FOUC-prevention script; on the client we mark it
 * `application/json` so React does not treat it as executable. SSR still
 * emits a real script so the theme class lands before first paint.
 */
export function Provider({ children }: { children: ReactNode }) {
  return (
    <RootProvider
      search={{ SearchDialog }}
      theme={{
        scriptProps: typeof window === "undefined" ? undefined : { type: "application/json" },
      }}
    >
      {children}
    </RootProvider>
  );
}
