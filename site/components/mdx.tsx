import defaultMdxComponents from "fumadocs-ui/mdx";
import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { Callout } from "fumadocs-ui/components/callout";
import { Card, Cards } from "fumadocs-ui/components/card";
import { File, Files, Folder } from "fumadocs-ui/components/files";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { TypeTable } from "fumadocs-ui/components/type-table";
import type { MDXComponents } from "mdx/types";
import { Features } from "@/components/docs/features";

/**
 * MDX component map — Fumadocs defaults plus the better-auth docs toolkit
 * (Steps, Tabs, Files, Callout, Cards, Features). Auth-only widgets omitted.
 *
 * @param components - Extra overrides from the page renderer
 */
export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Accordion,
    Accordions,
    Callout,
    Card,
    Cards,
    File,
    Files,
    Folder,
    Step,
    Steps,
    Tab,
    Tabs,
    TypeTable,
    Features,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
