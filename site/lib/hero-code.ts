/**
 * Hero code walk — one create Flow that touches all eight elements, tokenised
 * by the same Shiki themes the handbook code blocks use so the hero snippet
 * and the docs snippet read identically.
 */

import { codeToTokens } from "shiki";

/** One rendered token: text plus the dual-theme `--shiki-*` colour pair. */
export type HeroCodeToken = {
  readonly content: string;
  readonly style: Record<string, string>;
};

/** One line of the walk, and the fx beat it belongs to (`null` = scaffolding). */
export type HeroCodeLine = {
  readonly beat: number | null;
  readonly tokens: ReadonlyArray<HeroCodeToken>;
};

/**
 * Compact reading of a create Flow through every element. Beat indices match
 * `HERO_FX_BEATS`; every needle there is gated against this source by test.
 */
export const HERO_CODE_LINES: ReadonlyArray<{
  readonly text: string;
  readonly beat: number | null;
}> = [
  { text: "export const create = on(", beat: 0 },
  { text: "  http.post({ in: NoteCreateIn, out: NoteOut })", beat: 0 },
  { text: "    .gate(notesMutate),", beat: 1 },
  { text: "  flow({", beat: 0 },
  { text: "    do: async (input, fx) => {", beat: null },
  { text: "      await fx.vault.get(webhookSecret);", beat: 2 },
  { text: "      const id = fx.id();", beat: null },
  { text: "      const createdAt = new Date(fx.clock.now());", beat: 3 },
  { text: "      const summary = await fx.ask(summarize, { body: input.body });", beat: 4 },
  { text: "      await fx.store(db).insert(notes).values({ … });", beat: 5 },
  { text: "      await fx.emit(noteCreated, { id, title }, { key: id });", beat: 6 },
  { text: "      await fx.send(noteCreatedMail, { to, data: { id, title } });", beat: 7 },
  { text: "      return { id, title, summary, createdAt };", beat: null },
  { text: "    },", beat: null },
  { text: "  }),", beat: null },
  { text: ");", beat: null },
];

/** Joined source of the displayed walk — the honesty gate for `HERO_FX_BEATS`. */
export const HERO_CODE_SOURCE: string = HERO_CODE_LINES.map((line) => line.text).join("\n");

/**
 * Tokenise the walk once at build time. The whole block goes through the
 * grammar together, so multi-line constructs colour the way the file does.
 */
export async function loadHeroCodeLines(): Promise<ReadonlyArray<HeroCodeLine>> {
  const { tokens } = await codeToTokens(HERO_CODE_SOURCE, {
    lang: "ts",
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });

  return HERO_CODE_LINES.map((line, index) => ({
    beat: line.beat,
    tokens: (tokens[index] ?? []).map((token) => ({
      content: token.content,
      style: (token.htmlStyle ?? {}) as Record<string, string>,
    })),
  }));
}
