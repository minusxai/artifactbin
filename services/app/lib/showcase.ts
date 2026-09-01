/**
 * THE FEATURED WALL'S CONTENT — the one place a showcased document is named.
 *
 * These are real documents on the canonical instance, addressed ABSOLUTELY on
 * purpose: a self-hosted or local instance does not have these ids, and a
 * relative `/a/<id>` there is a 404 wearing a screenshot. The card image is
 * the product's own public `mode=card` capture (1600×840), so a featured
 * document's picture is always the document — there is no second asset to
 * keep in step with it, and nothing to re-shoot when its author edits it.
 *
 * `version` pins the picture rather than describing it: the capture is cached
 * for a day by artifact and version (lib/export), so bumping this number is
 * how a stale card is retired. Leave it at the version you curated and the
 * wall keeps showing what you looked at.
 *
 * A document earns a place here by being worth OPENING — the wall is a row of
 * links, not decoration, so every entry needs a title a stranger can act on
 * and a blurb that says what they are about to read.
 */

/** Where the featured documents actually live. */
export const SHOWCASE_ORIGIN = 'https://artifactbin.dev';

/** The shape a reader is about to open. Sets expectations before the click. */
export type ShowcaseKind = 'report' | 'deck' | 'dashboard' | 'data story' | 'coding agent plan';

export interface ShowcaseDoc {
  /**
   * WHERE IT SITS IN THE WHEEL. Ordering by a key rather than by position in
   * the array means reordering is editing one number, not moving a block of
   * text past three others and hoping nothing was dropped. Unique, and the
   * gaps do not matter — 10/20/30 leaves room to slot one in between.
   */
  order: number;
  /** The artifact id — its address on the canonical instance. */
  id: string;
  /**
   * The document is a STAND-IN: the use case is real and the picture is not
   * of it. Here so a phrase can be laid out before its document exists —
   * every one of these is visible on the live landing page until it is
   * replaced, so they are marked rather than silently blended in.
   */
  placeholder?: true;
  title: string;
  /** One line, sentence case, saying what the document is. */
  blurb: string;
  kind: ShowcaseKind;
  /**
   * What this document is an example of, phrased to complete the sentence
   * "You can use artifact-bin to …". A use case with a real published
   * document under it is an argument; one without is a claim, which is why
   * this rides the showcase entry rather than living in its own list.
   *
   * KEEP IT SHORT. The wheel gives each phrase ONE line beside the stem and
   * truncates what does not fit — and a use case the reader cannot finish
   * reading is the one thing the wheel exists to say.
   */
  use: string;
  /** The version the card picture was curated at; pins the capture cache. */
  version: number;
}

/**
 * Curated, ordered — the wall reads left to right, so the strongest document
 * leads. Adding one is a single entry; there is no other file to touch.
 */
const ENTRIES: readonly ShowcaseDoc[] = [
  {
    order: 4,
    id: 'wxeC8G',
    placeholder: true,
    title: 'Vol 1: Built something cool? Show HN.',
    blurb: 'Stand-in picture — swap for the plan-annotation document.',
    kind: 'coding agent plan',
    use: 'annotate coding agent plans',
    version: 199,
  },
  {
    order: 3,
    id: 'YPLu0U',
    title: 'The OpenAI-Hugging Face incident',
    blurb: 'A reported piece with its own tables, published by an agent in one pass.',
    kind: 'report',
    use: 'write incident reports',
    version: 31,
  },
  {
    order: 2,
    id: 'wxeC8G',
    title: 'Vol 1: Built something cool? Show HN.',
    blurb: 'Fifteen years of Show HN: nine times the crowd, the same door.',
    kind: 'data story',
    use: 'create beautiful data stories',
    version: 199,
  },
  {
    order: 5,
    id: '6bXsx3',
    placeholder: true,
    title: 'Vol 2: Show HN Hall of Fame',
    blurb: 'Stand-in picture — swap for a real deck.',
    kind: 'deck',
    use: 'create enviable presentations',
    version: 103,
  },
  {
    order: 1,
    id: 'OewuPR',
    title: 'San Francisco City Payroll',
    blurb: 'A payroll dashboard whose tiles query the data in your own browser.',
    kind: 'dashboard',
    use: 'create stunning data-backed dashboards',
    version: 3,
  },
  {
    order: 6,
    id: '6bXsx3',
    title: 'Vol 2: Show HN Hall of Fame',
    blurb: 'The thirty-four repeat fliers, and the top ten of every year.',
    kind: 'report',
    use: 'rank and profile any dataset',
    version: 103,
  },
];

/** The wheel reads this, so `order` is the only thing that decides sequence. */
export const SHOWCASE: readonly ShowcaseDoc[] = [...ENTRIES].sort((a, b) => a.order - b.order);

/** Where the card's click goes: the live document, on the instance that has it. */
export const showcaseHref = (doc: ShowcaseDoc): string => `${SHOWCASE_ORIGIN}/a/${doc.id}`;

/**
 * The document's own public capture — the picture IS the document. JPEG, as
 * the shelf's thumbnails are: the same wall in PNG measured 813 KB for ONE
 * card, for a picture that is never drawn wider than 380px.
 */
export const showcaseCardUrl = (doc: ShowcaseDoc): string =>
  `${SHOWCASE_ORIGIN}/a/${doc.id}/export?format=jpg&mode=card&v=${doc.version}`;
