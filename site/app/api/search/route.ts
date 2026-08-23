import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";

// Statically cached at build time.
export const revalidate = false;

export const { staticGET: GET } = createFromSource(source);
