import localFont from "next/font/local";
import { Provider } from "@/components/provider";
import { Topbar } from "@/components/chrome/topbar";
import { OkeFaviconCycle } from "@/components/oke-logo-icon";
import { ScrollToTop } from "@/components/scroll-to-top";
import { UnregisterServiceWorkers } from "@/components/unregister-service-workers";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site-identity";
import { source } from "@/lib/source";
import type { Metadata } from "next";
import "./global.css";

const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  // Keep in sync with src/docs-origin.ts / site/lib/site-identity.ts
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
};

/**
 * The header lives here, not in the per-surface layouts: its brand cell width is a
 * share of the surface below it, so it has to stay mounted across navigation for
 * that width — and the active tab marker — to animate rather than snap.
 */
export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Provider>
          <OkeFaviconCycle />
          <ScrollToTop />
          <UnregisterServiceWorkers />
          <Topbar tree={source.getPageTree()} />
          {children}
        </Provider>
      </body>
    </html>
  );
}
