/**
 * Parallel Console SPA entry — Query + theme + nuqs providers, claim page only.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { restoreAccessToken } from "./client.ts";
import { ThemeProvider } from "@/components/theme-provider";
import "./styles.css";

restoreAccessToken();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
  },
});

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Missing #root");
}

createRoot(rootEl).render(
  <StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="oke-console-theme">
      <QueryClientProvider client={queryClient}>
        <NuqsAdapter>
          <App />
        </NuqsAdapter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
