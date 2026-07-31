import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";

// Statically cached — static export downloads this index once.
export const revalidate = false;

export const { staticGET: GET } = createFromSource(source);
