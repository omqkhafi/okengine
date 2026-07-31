import defaultMdxComponents from "fumadocs-ui/mdx";
import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { Callout } from "fumadocs-ui/components/callout";
import { Card, Cards } from "fumadocs-ui/components/card";
import { File, Files, Folder } from "fumadocs-ui/components/files";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { TypeTable } from "fumadocs-ui/components/type-table";
import type { MDXComponents } from "mdx/types";
import { ClientLoop } from "@/components/docs/client-loop";
import { CollapseBoard } from "@/components/docs/collapse-board";
import { DevModes } from "@/components/docs/dev-modes";
import { DriftBoard } from "@/components/docs/drift-board";
import { AiGuardrails } from "@/components/docs/elements/ai-guardrails";
import { ChannelPhysics } from "@/components/docs/elements/channel-physics";
import { ClockSchedules } from "@/components/docs/elements/clock-schedules";
import { FlowTriggers } from "@/components/docs/elements/flow-triggers";
import { GatePipeline } from "@/components/docs/elements/gate-pipeline";
import { SignalDelivery } from "@/components/docs/elements/signal-delivery";
import { StoreFacets } from "@/components/docs/elements/store-facets";
import { VaultResolution } from "@/components/docs/elements/vault-resolution";
import { Features } from "@/components/docs/features";
import { FlowShape } from "@/components/docs/flow-shape";
import { CollapseDiagram } from "@/components/landing/collapse-diagram";
import { ManifestPipeline } from "@/components/landing/manifest-pipeline";
import { Surfaces } from "@/components/landing/surfaces";
import { Vocabulary } from "@/components/landing/vocabulary";

/**
 * MDX component map — Fumadocs defaults, docs toolkit, and get-started visuals
 * (Features, CollapseDiagram, ManifestPipeline, Surfaces, Vocabulary, plus
 * custom FlowShape / DevModes / ClientLoop / DriftBoard / CollapseBoard) and
 * per-element visuals
 * (FlowTriggers, SignalDelivery, StoreFacets, ClockSchedules, GatePipeline,
 * VaultResolution, ChannelPhysics, AiGuardrails).
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
    CollapseDiagram,
    ManifestPipeline,
    Surfaces,
    Vocabulary,
    FlowShape,
    DevModes,
    ClientLoop,
    DriftBoard,
    CollapseBoard,
    FlowTriggers,
    SignalDelivery,
    StoreFacets,
    ClockSchedules,
    GatePipeline,
    VaultResolution,
    ChannelPhysics,
    AiGuardrails,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
