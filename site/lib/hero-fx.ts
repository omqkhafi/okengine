import { ELEMENTS, type ElementPreviewKind } from "@/lib/elements";

/**
 * One beat in the homepage fx walk — a real substring of the displayed create
 * Flow, mapped onto the element it touches through `fx`.
 */
export type HeroFxBeat = {
  readonly preview: ElementPreviewKind;
  /** Must appear verbatim in `HERO_CODE_SOURCE`. */
  readonly needle: string;
  readonly code: string;
  readonly note: string;
};

/**
 * Homepage hero walk — one beat per element, in the order the create Flow
 * actually touches them. Every needle is gated against the displayed source.
 */
export const HERO_FX_BEATS: readonly HeroFxBeat[] = [
  {
    preview: "flow",
    needle: "http.post({ in: LinkCreateIn, out: LinkOut })",
    code: "on(http.post({ in, out })",
    note: "the trigger is a typed value",
  },
  {
    preview: "gate",
    needle: ".gate(linksMutate)",
    code: ".gate(linksMutate)",
    note: "permission sits on the exposure",
  },
  {
    preview: "vault",
    needle: "fx.vault.get(publicApiUrl)",
    code: "fx.vault.get(publicApiUrl)",
    note: "secrets only through fx",
  },
  {
    preview: "clock",
    needle: "fx.clock.now()",
    code: "fx.clock.now()",
    note: "time is an effect, not Date.now",
  },
  {
    preview: "ai",
    needle: "fx.ask(summarize",
    code: "fx.ask(summarize, …)",
    note: "models through a named prompt",
  },
  {
    preview: "store",
    needle: "fx.store(db).insert(links)",
    code: "fx.store(db).insert(links)",
    note: "writes are inferred, not annotated",
  },
  {
    preview: "signal",
    needle: "fx.emit(linkCreated",
    code: "fx.emit(linkCreated, …)",
    note: "the next Flow wakes on the same species",
  },
  {
    preview: "channel",
    needle: "fx.send(linkCreatedMail",
    code: "fx.send(linkCreatedMail, …)",
    note: "humans through a named template",
  },
];

/**
 * Lattice index for a hero fx beat — same order as `ELEMENTS`.
 *
 * @param preview - Element preview kind on the beat
 */
export function heroFxElementIndex(preview: ElementPreviewKind): number {
  return ELEMENTS.findIndex((element) => element.preview === preview);
}
