import type { Metadata } from "next";
import { NotFoundView } from "@/components/not-found/not-found-view";

export const metadata: Metadata = {
  title: "Not found",
  description: "No Flow matched this path.",
  robots: { index: false, follow: true },
};

/**
 * Global 404 — unknown URLs and `notFound()` from route segments.
 */
export default function NotFound() {
  return <NotFoundView />;
}
