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
 * WHICH PART OF THE DOCUMENT PROVES THIS CLAIM. The why section is one
 * artifact with the four claims pinned onto it (WhyArtifact), so a claim does
 * not carry a figure of its own — it carries the NAME of the thing on the
 * plate that demonstrates it. That is what keeps the four honest: a claim with
 * nothing to point at has no business on a page whose pitch is that it shows
 * rather than tells.
 */
export type ReasonDemo = 'tokens' | 'themes' | 'edit' | 'annotate';

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

/** The ink in the art — its navy — used for type and rules on the paper band. */
export const ART_INK = '#1f2a3a';

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
  /**
   * The pinned part of the anatomy plate that runs this claim, where the plate
   * carries one. A claim can be true and illustrated without being something a
   * single mock document can act out, which is why this is optional.
   */
  demo?: ReasonDemo;
  body: string;
  /** A checkable fact — a number or a hard rule. Never a superlative. */
  proof: string;
}

export const REASONS: readonly Reason[] = [
  {
    title: 'Ship beautiful work',
    image: 'beautiful',
    alt: 'A crate of finished documents, each one already laid out and charted',
    demo: 'themes',
    body: 'Hand-curated themes, templates and visualizations mean it looks designed before you touch it — and it changes when you do.',
    proof: `${STORY_THEME_NAMES.length} themes, ${STORY_TEMPLATE_NAMES.length} templates, and your own CSS over any of it.`,
  },
  {
    title: 'Make changes directly',
    image: 'human_editable',
    alt: 'A hand lifting a chart tile out of a document and setting it somewhere else',
    demo: 'edit',
    body: 'A built-in visual editor lets you edit the text, restyle a section and refine a chart without another round of prompting.',
    proof: 'A full visual editor, built into every artifact.',
  },
  {
    title: 'Collaborate in context',
    image: 'collaboration',
    alt: 'Two hands and two robot arms pinning comments to the same document',
    demo: 'annotate',
    body: 'Inline annotations give teammates and agents one shared place to review, respond, and resolve feedback.',
    proof: 'Humans and agents collaborate on the same artifact.',
  },
  {
    title: 'Spend fewer tokens',
    image: 'token-efficient',
    alt: 'A query lamp reading one lit row out of a wall of stored data',
    demo: 'tokens',
    body: 'Datasets live outside the artifact, and can be queried via DuckDB SQL. 10× more token-efficient for data-heavy artifacts',
    proof: 'Up to 10× more token-efficient for data-heavy artifacts.',
  },
  {
    title: 'Use any agent, any harness',
    image: 'anyagent',
    alt: 'A terminal, a robot and other machines all feeding one shared bin of documents',
    body: 'A simple HTTP protocol works with Claude Code, Codex, Pi, Opencode, plain curl, and whatever comes next.',
    proof: 'One URL teaches any agent the entire integration.',
  },
  {
    title: 'Own the whole stack',
    image: 'bin',
    alt: 'A crate holding every kind of published document at once',
    body: 'An Apache-2.0, self-hostable stack keeps your artifacts and infrastructure under your control.',
    proof: 'Open source, self-hosted, and free from vendor lock-in.',
  },
];