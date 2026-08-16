/**
 * Console router — code-based TanStack Router (Vite SPA).
 * Pre-auth `/` and authenticated shell `/overview` | `/flows` | `/store` | `/vault` | `/monitoring`.
 * Authenticated pages are `lazyRouteComponent` so Vite splits them out of the entry.
 * Any other path is a 404 — no legacy rewrites.
 */

import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import {
  getAccessToken,
  sessionMe,
  setAccessToken,
  setSessionExpiredHandler,
  setSessionOperator,
  type SessionOperator,
} from "./client.ts";
import { authGateSearch, validateAuthSearch } from "./features/auth/auth-redirect.ts";
import { NotFoundPage } from "./features/not-found/not-found-page.tsx";
import { ClaimPage } from "./features/setup/claim-page.tsx";
import { validateFlowsSearch } from "./features/flows/state/flows-selection.ts";
import { validateStoreSearch } from "./features/store/state/store-selection.ts";
import { validateUnitsSearch } from "./features/units/state/units-selection.ts";
import { validateMonitoringSearch } from "./features/monitoring/state/monitoring-selection.ts";
import { validateVaultSearch } from "./features/vault/state/vault-selection.ts";
import { ShellLayout } from "./components/shell/shell-layout.tsx";

/**
 * Validate `oke_console_at` via `/console/session/me` and return the operator.
 * Clears a stale token and redirects to the pre-auth gate when invalid,
 * keeping the current module in `?next=` so login can restore it.
 */
async function requireSession({
  location,
}: {
  location: { pathname: string; searchStr: string };
}): Promise<{ operator: SessionOperator }> {
  const search = authGateSearch(`${location.pathname}${location.searchStr}`);
  const token = getAccessToken();
  if (!token) {
    throw redirect({ to: "/", search });
  }

  const res = await sessionMe();
  if (res.error || !res.data) {
    setAccessToken(null);
    throw redirect({ to: "/", search });
  }

  const operator: SessionOperator = {
    operatorId: res.data.operatorId,
    email: res.data.email,
    name: res.data.name,
  };
  setSessionOperator(operator);
  return { operator };
}

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: validateAuthSearch,
  component: ClaimPage,
});

const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authenticated",
  beforeLoad: requireSession,
  component: function AuthenticatedShell() {
    const { operator } = authenticatedRoute.useRouteContext();
    return <ShellLayout operator={operator} />;
  },
});

const overviewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/overview",
  validateSearch: validateFlowsSearch,
  component: lazyRouteComponent(() => import("./features/flows/flows-page.tsx"), "FlowsPage"),
});

const flowsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/flows",
  validateSearch: validateUnitsSearch,
  component: lazyRouteComponent(() => import("./features/units/units-page.tsx"), "UnitsPage"),
});

const storeRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/store",
  validateSearch: validateStoreSearch,
  component: lazyRouteComponent(() => import("./features/store/store-page.tsx"), "StorePage"),
});

const vaultRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/vault",
  validateSearch: validateVaultSearch,
  component: lazyRouteComponent(() => import("./features/vault/vault-page.tsx"), "VaultPage"),
});

const monitoringRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/monitoring",
  validateSearch: validateMonitoringSearch,
  component: lazyRouteComponent(
    () => import("./features/monitoring/monitoring-page.tsx"),
    "MonitoringPage",
  ),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  authenticatedRoute.addChildren([
    overviewRoute,
    flowsRoute,
    storeRoute,
    vaultRoute,
    monitoringRoute,
  ]),
]);

/**
 * Application router for the Console SPA.
 */
export const router = createRouter({
  routeTree,
  defaultNotFoundComponent: NotFoundPage,
  defaultPendingComponent: () => (
    <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">Loading…</div>
  ),
});

setSessionExpiredHandler((returnTo) => {
  const path = returnTo.split("?")[0] ?? "";
  if (path === "/" || path === "") return;
  void router.navigate({ to: "/", search: authGateSearch(returnTo) });
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
