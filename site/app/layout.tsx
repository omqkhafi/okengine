import { Inter } from "next/font/google";
import { Provider } from "@/components/provider";
import { Topbar } from "@/components/chrome/topbar";
import { OkeFaviconCycle } from "@/components/oke-logo-icon";
import { source } from "@/lib/source";
import type { Metadata } from "next";
import "./global.css";

const inter = Inter({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Keep in sync with src/docs-origin.ts
  metadataBase: new URL("https://oke.omqkhafi.dev"),
  title: {
    default: "okengine",
    template: "%s | okengine",
  },
  description:
    "One law. Eight elements. Ten exports. The batteries-included TypeScript backend for the Bun era.",
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
          <Topbar tree={source.getPageTree()} />
          {children}
        </Provider>
      </body>
    </html>
  );
}
