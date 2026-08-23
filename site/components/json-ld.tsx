/**
 * Emit a JSON-LD script tag. Values come from the caller — this component
 * does not invent structured data.
 */

import type { ReactNode } from "react";

/**
 * @param data - JSON-serializable graph (already validated by the caller)
 */
export function JsonLd({ data }: { readonly data: unknown }): ReactNode {
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
  );
}
