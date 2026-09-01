/**
 * WHAT THE LANDING PAGE SAYS — content as data, so a design can be replaced
 * without retyping the argument, and two designs under review cannot quietly
 * make different claims.
 *
 * REASONS — why this rather than a gist, a notebook, or an HTML file in a
 * bucket. Each one is a mechanism with a consequence, never an adjective: the
 * claims here are checkable against lib/story/dataset-store, lib/story/splice,
 * lib/story/frame and lib/annotations.
 *
 * What a person would DO with it is NOT a list here — those live on the
 * showcase entries (lib/showcase `use`), because a use case is only worth
 * stating beside the published document that is an example of it.
 */

import { STORY_TEMPLATE_NAMES, STORY_THEME_NAMES } from '@/lib/validation/atlas-schemas';

/**
 * THE TWO RENDERINGS OF THE ART. Every illustration exists as a solid felt-craft
 * render and as a watercolour of the same scene, and the landing carries both
 * so the two can be compared in place rather than described. The suffix IS the
 * variant — `beautiful.png` and `beautiful-water.png` — so a component picks a
 * rendering by naming one, and neither list can drift from the other.
 */
export type ArtVariant = 'felt' | 'water';

/**
 * THE PAPER EACH RENDERING SITS ON, sampled from the art itself (the mean of
 * the four corner pixels across the set, measured — not matched by eye). The
 * features band is painted this colour so the illustrations land on their own
 * ground instead of on a square of somebody else's — which is what lets the
 * section drop image frames entirely and let the art sit on the sheet.
 */
export const ART_PAPER: Record<ArtVariant, string> = {
  felt: '#f1e6d4',
  water: '#f7edd8',
};

/**
 * THE CARD A SPECIMEN IS MOUNTED ON — a few percent lighter than the band, so a
 * bordered card reads as stock laid on the sheet rather than as a box drawn on
 * it. Kept close to the band on purpose: the halo behind each picture fades
 * into THIS colour now, and a card fill far from the art's own ground would put
 * back the square the halo exists to remove.
 */
export const ART_CARD: Record<ArtVariant, string> = {
  felt: '#f8f1e3',
  water: '#fdf6e8',
};

/**
 * EACH ILLUSTRATION'S OWN PAPER, because the set is not one colour. The band is
 * the MEAN of these, so a picture whose ground sits far from it — the yellow
 * cast on the watercolour `human_editable`, the near-white `anyagent` — showed
 * as a faint square no edge fade could hide: the mismatch is around the object,
 * where the picture must stay fully opaque, not out at the border.
 *
 * So the picture is laid on a HALO of its own ground, and the halo is what
 * fades into the band. The seam moves from a hard rectangle to a soft circle of
 * paper on paper, which is exactly what it looks like on a real sheet.
 *
 * Measured, never eyeballed: the mean of the four corner pixels of each file
 * (every one of them bare paper there). Re-measure with the script that emits
 * this map if the art is ever redrawn.
 */
export const ART_GROUND: Record<string, Record<ArtVariant, string>> = {
  anyagent: { felt: '#f6eddc', water: '#f8f3e7' },
  beautiful: { felt: '#ede1d0', water: '#f6e9d1' },
  bin: { felt: '#f3e9d6', water: '#f1e7d6' },
  collaboration: { felt: '#f0e2ce', water: '#f8ecd5' },
  human_editable: { felt: '#f4e9d6', water: '#faefce' },
  'token-efficient': { felt: '#ede2d2', water: '#f9f2e0' },
};

/**
 * ONE COLOUR PER SPECIMEN, none repeated. The first four are the colours the
 * illustrations are actually painted in — red, yellow, green, blue over navy —
 * and the last two extend that palette at the same muted value so a sheet of
 * six reads as one printed set with six plates, not as four plus a repeat.
 *
 * Taken from the art rather than from the app's terminal green, which belongs
 * to the chrome and fights this warm ground.
 *
 * Used as registration marks in the grid layout, at each cell's top-left and
 * bottom-right — the two corners a printer marks, and the pair that reads as a
 * plate being located on the sheet rather than as a decoration in one corner.
 */
export const ART_ACCENTS = [
  '#c9503c', // red
  '#e3a93a', // yellow
  '#3e8b5e', // green
  '#2f6cb8', // blue
  '#7a5aa8', // purple
  '#2f8a86', // teal
] as const;

/** The file for a claim's illustration at a given rendering and width. */
export const artSrc = (image: string, variant: ArtVariant, width: 380 | 760): string =>
  `/landing/${image}${variant === 'water' ? '-water' : ''}-${width}.webp`;

export interface Reason {
  /** The mechanism, named. */
  title: string;
  /**
   * The illustration's basename in public/landing. Both renderings and both
   * widths are derived from it by {@link artSrc}, so a claim names its picture
   * once.
   */
  image: string;
  /** What the illustration DEPICTS — never a repeat of the title. */
  alt: string;
  body: string;
}

export const REASONS: readonly Reason[] = [
  {
    title: "Make work you're proud to share",
    image: 'beautiful',
    alt: 'A crate filled with beautifully finished documents, charts and presentations',
    body: "You shouldn't have to settle for slop-looking artifacts. Start with thoughtfully designed themes, templates and visualizations, then make every detail your own.",
  },
  {
    title: 'Change it with your own hands',
    image: 'human_editable',
    alt: 'A hand lifting a chart from a document and moving it into place',
    body: "Sometimes it's easier to just fix the thing yourself than have a million back-and-forths with your agent.",
  },
  {
    title: 'Work on it together',
    image: 'collaboration',
    alt: 'Two people and two robot arms leaving notes on the same document',
    body: 'Leave feedback exactly where it belongs. Your human and agent teammates can respond, make changes and resolve comments.',
  },
  {
    title: "Don't waste tokens",
    image: 'token-efficient',
    alt: 'A lamp illuminating one useful row in a large table of stored data',
    body: "We've put a ton of elbow grease into making artifactbin insanely token-efficient. Eg: Keep large datasets outside the artifact and query only what you need with DuckDB SQL.",
  },
  {
    title: 'Bring your favorite agent',
    image: 'anyagent',
    alt: 'Different coding agents and tools feeding work into one shared bin',
    body: 'Use Claude Code, Codex, Pi, OpenCode, plain curl or whatever you try next. If it can make an HTTP request, it can publish to Artifactbin.',
  },
  {
    title: 'Artifactbin is truly yours',
    image: 'bin',
    alt: 'A sturdy crate holding every kind of published artifact',
    body: "Artifactbin is open source and self-hostable, so your artifacts and the infrastructure behind them stay in your hands.",
  },
];
/**
 * QUESTIONS — the ones a stranger is still holding after the claims above.
 *
 * Two of them are POSITIONING (why not the artifacts panel in the chat app I
 * already pay for; why not just write the HTML) and two are the universal
 * blockers on publishing anything (who sees it, what it costs). Deliberately
 * not a support page: everything operational — install, tokens, self-hosting —
 * has a doc, and a landing FAQ that starts answering those is a landing page
 * turning into one.
 *
 * The answers concede the honest thing FIRST where there is one ("for a
 * one-off page, do"), because a FAQ that argues with the reader's actual
 * objection is an ad, and reads like one. Each answer is then checkable: the
 * ownership claims against lib/artifacts and lib/share-roles, the pricing
 * sentence against lib/legal (`the hosted service is free today`) — it must
 * never promise something the terms do not.
 */
export interface Question {
  question: string;
  answer: string;
}

export const QUESTIONS: readonly Question[] = [
  {
    question: 'How is this different from Claude Artifacts or ChatGPT Sites?',
    answer:
      'Unlike those two, you can edit artifacts yourself, right in a WYSIWYG editor. Any agent can pick it up later, not just the one that made it, and it burns far fewer tokens on data-heavy artifacts.',
  },
  {
    question: 'What about Lovable, Bolt or Replit?',
    answer:
      'For most reports, dashboards, stories, these solutions are overkill. Also, I love my agent, and want to use that! Artifactbin keeps the infrastructure separate from the agent, so you can bring whatever model you like (including cheap ones like DeepSeek) and swap it whenever you want.',
  },
  {
    question: 'Why not just write an HTML file?',
    answer:
      'For a one-off, private pages, sure. Making it look good, putting it somewhere people can open, deciding who sees it, collecting feedback/comments, editing it later: that is the part you would rebuild every single time. Artifactbin brings all the infrastructure you need, out of the box.',
  },
  {
    question: 'Who can see what I publish?',
    answer:
      'Whoever you want. It works a lot like Google Docs: keep an artifact private, make it public, hand out an unlisted link, or invite specific people as readers, commenters or editors. Public and unlisted links open without an account.',
  },
  {
    question: 'Is it free?',
    answer:
      'Yes. Free as in beer for individuals, and free as in speech for everyone. The hosted service costs nothing today, and the whole stack is Apache-2.0, so you can always run it yourself.',
  },
];
