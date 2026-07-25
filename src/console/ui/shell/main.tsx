/**
 * Console SPA entry — React + TanStack Query/Router.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { parseFlowsSearch } from "../flows/search.ts";
import { parseRunsSearch } from "../runs/search.ts";
import { parseSignalsSearch } from "../signals/search.ts";
import { parseStoreSearch } from "../store/search.ts";
import { parseTracesSearch } from "../traces/search.ts";
import { App } from "./App.tsx";
import { restoreAccessToken } from "./client.ts";
import { OverviewPanel } from "./panels/Overview.tsx";
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
  component: OverviewPanel,
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

const routeTree = rootRoute.addChildren([
  indexRoute,
  flowsRoute,
  signalsRoute,
  storeRoute,
  tracesRoute,
  runsRoute,
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
