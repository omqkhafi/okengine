/**
 * ui-next router — code-based TanStack Router (Vite SPA, same pattern as current Console).
 * Pre-auth `/` and authenticated shell `/flows` | `/units` | `/store`.
 */

import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import {
  getAccessToken,
  sessionMe,
  setAccessToken,
  setSessionOperator,
  type SessionOperator,
} from "./client.ts";
import { ClaimPage } from "./features/setup/claim-page.tsx";
import { FlowsPage } from "./features/flows/flows-page.tsx";
import { validateFlowsSearch } from "./features/flows/state/flows-selection.ts";
import { StorePage } from "./features/store/store-page.tsx";
import { validateStoreSearch } from "./features/store/state/store-selection.ts";
import { UnitsPage } from "./features/units/units-page.tsx";
import { validateUnitsSearch } from "./features/units/state/units-selection.ts";
import { ShellLayout } from "./components/shell/shell-layout.tsx";

/**
 * Validate `oke_console_at` via `/console/session/me` and return the operator.
 * Clears a stale token and redirects to the pre-auth gate when invalid.
 */
async function requireSession(): Promise<{ operator: SessionOperator }> {
  const token = getAccessToken();
  if (!token) {
    throw redirect({ to: "/" });
  }

  const res = await sessionMe();
  if (res.error || !res.data) {
    setAccessToken(null);
    throw redirect({ to: "/" });
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

const flowsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/flows",
  validateSearch: validateFlowsSearch,
  component: FlowsPage,
});

const unitsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/units",
  validateSearch: validateUnitsSearch,
  component: UnitsPage,
});

const storeRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/store",
  validateSearch: validateStoreSearch,
  component: StorePage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  authenticatedRoute.addChildren([flowsRoute, unitsRoute, storeRoute]),
]);

/**
 * Application router for the parallel Console SPA.
 */
export const router = createRouter({
  routeTree,
  defaultPendingComponent: () => (
    <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground">Loading…</div>
  ),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
