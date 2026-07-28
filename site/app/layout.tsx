import { Inter } from "next/font/google";
import { Provider } from "@/components/provider";
import { Topbar } from "@/components/chrome/topbar";
import { source } from "@/lib/source";
import type { Metadata } from "next";
import "./global.css";

const inter = Inter({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Live: okengine.vercel.app · planned: oke.omqkhafi.dev (keep in sync with src/docs-origin.ts)
  metadataBase: new URL("https://okengine.vercel.app"),
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
          <Topbar tree={source.getPageTree()} />
          {children}
        </Provider>
      </body>
    </html>
  );
}
