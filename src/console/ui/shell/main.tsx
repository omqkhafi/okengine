/**
 * Console SPA entry — React + TanStack Query/Router.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { parseAccessSearch } from "../access/search.ts";
import { parseAiSearch } from "../ai/search.ts";
import { parseArchitectureSearch } from "../architecture/search.ts";
import { parseChannelsSearch } from "../channels/search.ts";
import { parseClockSearch } from "../clock/search.ts";
import { parseDiffSearch } from "../diff/search.ts";
import { parseFlowsSearch } from "../flows/search.ts";
import { parseGatesSearch } from "../gates/search.ts";
import { parseRunsSearch } from "../runs/search.ts";
import { parseSignalsSearch } from "../signals/search.ts";
import { parseStoreSearch } from "../store/search.ts";
import { parseTracesSearch } from "../traces/search.ts";
import { parseVaultSearch } from "../vault/search.ts";
import { parsePluginsSearch } from "../plugins/search.ts";
import { App } from "./App.tsx";
import { restoreAccessToken } from "./client.ts";
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

const rootRoute = createRootRoute({
  component: App,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/overview" });
  },
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/overview",
  component: lazyRouteComponent(
    () => import("./panels/Overview.tsx"),
    "default",
  ),
});

const flowsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/flows",
  validateSearch: (search: Record<string, unknown>) => parseFlowsSearch(search),
  component: lazyRouteComponent(
    () => import("./panels/Flows.tsx"),
    "default",
  ),
});

const tracesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/traces",
  validateSearch: (search: Record<string, unknown>) =>
    parseTracesSearch(search),
  component: lazyRouteComponent(
    () => import("./panels/Traces.tsx"),
    "default",
  ),
});

const runsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs",
  validateSearch: (search: Record<string, unknown>) =>
    parseRunsSearch(search),
  component: lazyRouteComponent(
    () => import("./panels/Runs.tsx"),
    "default",
  ),
});

const signalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signals",
  validateSearch: (search: Record<string, unknown>) =>
    parseSignalsSearch(search),
  component: lazyRouteComponent(
    () => import("./panels/Signals.tsx"),
    "default",
  ),
});

const storeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/store",
  validateSearch: (search: Record<string, unknown>) =>
    parseStoreSearch(search),
  component: lazyRouteComponent(
    () => import("./panels/Store.tsx"),
    "default",
  ),
});

const vaultRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/vault",
  validateSearch: (search: Record<string, unknown>) =>
    parseVaultSearch(search),
  component: lazyRouteComponent(
    () => import("./panels/Vault.tsx"),
    "default",
  ),
});

const gatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/gates",
  validateSearch: (search: Record<string, unknown>) =>
    parseGatesSearch(search),
  component: lazyRouteComponent(
    () => import("./panels/Gates.tsx"),
    "default",
  ),
});

const clockRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clock",
  validateSearch: (search: Record<string, unknown>) =>
    parseClockSearch(search),
  component: lazyRouteComponent(
    () => import("./panels/Clock.tsx"),
    "default",
  ),
});

const aiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ai",
  validateSearch: (search: Record<string, unknown>) => parseAiSearch(search),
  component: lazyRouteComponent(
    () => import("./panels/Ai.tsx"),
    "default",
  ),
});

const channelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/channels",
  validateSearch: (search: Record<string, unknown>) =>
    parseChannelsSearch(search),
  component: lazyRouteComponent(
    () => import("./panels/Channels.tsx"),
    "default",
  ),
});

const architectureRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/architecture",
  validateSearch: (search: Record<string, unknown>) =>
    parseArchitectureSearch(search),
  component: lazyRouteComponent(
    () => import("./panels/Architecture.tsx"),
    "default",
  ),
});

const accessRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/access",
  validateSearch: (search: Record<string, unknown>) =>
    parseAccessSearch(search),
  component: lazyRouteComponent(
    () => import("./panels/Access.tsx"),
    "default",
  ),
});

const manifestDiffRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/manifest-diff",
  validateSearch: (search: Record<string, unknown>) =>
    parseDiffSearch(search),
  component: lazyRouteComponent(
    () => import("./panels/Diff.tsx"),
    "default",
  ),
});

/** Alias for AI deep-links that historically used `/diff`. */
const diffAliasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/diff",
  validateSearch: (search: Record<string, unknown>) =>
    parseDiffSearch(search),
  component: lazyRouteComponent(
    () => import("./panels/Diff.tsx"),
    "default",
  ),
});

const pluginsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/plugins",
  validateSearch: (search: Record<string, unknown>) =>
    parsePluginsSearch(search),
  component: lazyRouteComponent(
    () => import("./panels/Plugins.tsx"),
    "default",
  ),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  overviewRoute,
  flowsRoute,
  signalsRoute,
  storeRoute,
  clockRoute,
  gatesRoute,
  vaultRoute,
  channelsRoute,
  aiRoute,
  architectureRoute,
  accessRoute,
  tracesRoute,
  runsRoute,
  manifestDiffRoute,
  diffAliasRoute,
  pluginsRoute,
]);
const router = createRouter({
  routeTree,
  defaultPendingComponent: () => (
    <div className="grid h-full place-items-center text-[var(--oke-muted)]">
      Loading panel…
    </div>
  ),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const el = document.getElementById("root");
if (!el) throw new Error("missing #root");

createRoot(el).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Suspense
        fallback={
          <div className="grid h-full place-items-center text-[var(--oke-muted)]">
            Loading…
          </div>
        }
      >
        <RouterProvider router={router} />
      </Suspense>
    </QueryClientProvider>
  </StrictMode>,
);
