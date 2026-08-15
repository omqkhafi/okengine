/**
 * HugeIcons vocabulary for the eight OKE elements.
 *
 * Mirrors `site/lib/elements.ts` (Lucide) so Console graph, Traces, and
 * chrome share one glyph language — not a second invented set.
 */

import {
  AiMagicIcon,
  Clock01Icon,
  Database01Icon,
  FlowCircleIcon,
  Key01Icon,
  Mail01Icon,
  Radio01Icon,
  SecurityCheckIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";

/** One of the eight elements. */
export type OkeElement =
  | "flow"
  | "signal"
  | "store"
  | "clock"
  | "gate"
  | "vault"
  | "channel"
  | "ai";

/** HugeIcons icon component type used by Console. */
export type ElementHugeIcon = ComponentProps<typeof HugeiconsIcon>["icon"];

/** Icon + short label for an element. */
export type ElementIconSpec = {
  readonly icon: ElementHugeIcon;
  readonly label: string;
  /** Two-letter lattice symbol — presentation only, not an API name. */
  readonly symbol: string;
};

/**
 * Canonical Console icon per element (aligned with site Lucide choices).
 *
 * | Element | Site Lucide | HugeIcons |
 * |---|---|---|
 * | flow | Workflow | FlowCircle |
 * | signal | Radio | Radio01 |
 * | store | Database | Database01 |
 * | clock | Clock | Clock01 |
 * | gate | ShieldCheck | SecurityCheck |
 * | vault | KeyRound | Key01 |
 * | channel | Mail | Mail01 |
 * | ai | Sparkles | AiMagic |
 */
export const ELEMENT_ICONS: Record<OkeElement, ElementIconSpec> = {
  flow: { icon: FlowCircleIcon, label: "Flow", symbol: "Fl" },
  signal: { icon: Radio01Icon, label: "Signal", symbol: "Sg" },
  store: { icon: Database01Icon, label: "Store", symbol: "St" },
  clock: { icon: Clock01Icon, label: "Clock", symbol: "Ck" },
  gate: { icon: SecurityCheckIcon, label: "Gate", symbol: "Gt" },
  vault: { icon: Key01Icon, label: "Vault", symbol: "Vt" },
  channel: { icon: Mail01Icon, label: "Channel", symbol: "Ch" },
  ai: { icon: AiMagicIcon, label: "AI", symbol: "Ai" },
};

/**
 * Resolve the icon spec for an element.
 *
 * @param element - Element name
 */
export function elementIcon(element: OkeElement): ElementIconSpec {
  return ELEMENT_ICONS[element];
}
