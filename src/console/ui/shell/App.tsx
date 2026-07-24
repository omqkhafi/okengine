/**
 * Console shell root — setup gate + overview.
 */

import { useQuery } from "@tanstack/react-query";
import { consoleCalls } from "./client.ts";
import { OverviewPanel } from "./panels/Overview.tsx";
import { SetupWizard } from "./setup/Wizard.tsx";

/**
 * Root application view.
 */
export function App() {
  const status = useQuery({
    queryKey: ["console.setup.status"],
    queryFn: async () => {
      const res = await consoleCalls.setupStatus();
      if (res.error) throw new Error(res.error.code);
      return res.data as { setupClosed: boolean };
    },
  });

  const me = useQuery({
    queryKey: ["console.session.me"],
    enabled: status.data?.setupClosed === true,
    retry: false,
    queryFn: async () => {
      const res = await consoleCalls.sessionMe();
      if (res.error) throw new Error(res.error.code);
      return res.data;
    },
  });

  if (status.isLoading) {
    return (
      <main className="grid h-full place-items-center text-[var(--oke-muted)]">
        Loading…
      </main>
    );
  }

  if (!status.data?.setupClosed || me.isError || !me.data) {
    return (
      <main>
        <SetupWizard />
      </main>
    );
  }

  return (
    <main>
      <OverviewPanel />
    </main>
  );
}
