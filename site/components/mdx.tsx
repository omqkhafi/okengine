import defaultMdxComponents from "@fumadocs/base-ui/mdx";
import { Accordion, Accordions } from "@fumadocs/base-ui/components/accordion";
import { Callout } from "@fumadocs/base-ui/components/callout";
import { Card, Cards } from "@fumadocs/base-ui/components/card";
import { File, Files, Folder } from "@fumadocs/base-ui/components/files";
import { Step, Steps } from "@fumadocs/base-ui/components/steps";
import { Tab, Tabs } from "@fumadocs/base-ui/components/tabs";
import { TypeTable } from "@fumadocs/base-ui/components/type-table";
import type { MDXComponents } from "mdx/types";
import { ClientLoop } from "@/components/docs/client-loop";
import { CollapseBoard } from "@/components/docs/collapse-board";
import { DevModes } from "@/components/docs/dev-modes";
import { DriftBoard } from "@/components/docs/drift-board";
import { AiBlocks } from "@/components/docs/elements/ai-blocks";
import { AiGuardrails } from "@/components/docs/elements/ai-guardrails";
import { AiPiiEgress } from "@/components/docs/elements/ai-physics";
import { ChannelPhysics } from "@/components/docs/elements/channel-physics";
import { ClockCatchUp, ClockSleep } from "@/components/docs/elements/clock-physics";
import { ClockSchedules } from "@/components/docs/elements/clock-schedules";
import { FlowDurable } from "@/components/docs/elements/flow-durable";
import { FlowTriggers } from "@/components/docs/elements/flow-triggers";
import { GatePipeline } from "@/components/docs/elements/gate-pipeline";
import { SignalDelivery } from "@/components/docs/elements/signal-delivery";
import { SignalLiveReplay, SignalOnceLease } from "@/components/docs/elements/signal-physics";
import { StoreFacetMark, StoreFacets } from "@/components/docs/elements/store-facets";
import {
  StoreFilesVariants,
  StoreIndexModes,
  StoreKvTtl,
} from "@/components/docs/elements/store-physics";
import { StoreSeeding } from "@/components/docs/elements/store-seeding";
import { VaultRedacted } from "@/components/docs/elements/vault-redacted";
import { VaultResolution } from "@/components/docs/elements/vault-resolution";
import { Features } from "@/components/docs/features";
import { FlowShape } from "@/components/docs/flow-shape";
import { SixSystemsDrift } from "@/components/docs/understand/six-systems-drift";
import { CollapseDiagram } from "@/components/landing/collapse-diagram";
import { ManifestPipeline } from "@/components/landing/manifest-pipeline";
import { Surfaces } from "@/components/landing/surfaces";
import { Vocabulary } from "@/components/landing/vocabulary";

/**
 * MDX component map — Fumadocs defaults, docs toolkit, and handbook visuals
 * (Features, CollapseDiagram, ManifestPipeline, Surfaces, Vocabulary, plus
 * custom FlowShape / DevModes / ClientLoop / DriftBoard / CollapseBoard) and
 * per-element visuals
 * (FlowTriggers, FlowDurable, SignalDelivery, SignalOnceLease,
 * SignalLiveReplay, StoreFacets, StoreFacetMark, StoreKvTtl,
 * StoreFilesVariants, StoreIndexModes, StoreSeeding, ClockSchedules, ClockCatchUp,
 * ClockSleep, GatePipeline, VaultResolution, VaultRedacted, ChannelPhysics,
 * AiBlocks, AiGuardrails, AiPiiEgress).
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
    FlowDurable,
    SignalDelivery,
    SignalOnceLease,
    SignalLiveReplay,
    StoreFacets,
    StoreFacetMark,
    StoreKvTtl,
    StoreFilesVariants,
    StoreIndexModes,
    StoreSeeding,
    ClockSchedules,
    ClockCatchUp,
    ClockSleep,
    GatePipeline,
    VaultResolution,
    VaultRedacted,
    ChannelPhysics,
    AiBlocks,
    AiGuardrails,
    AiPiiEgress,
    SixSystemsDrift,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
