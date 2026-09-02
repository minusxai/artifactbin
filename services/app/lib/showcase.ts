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
 * The address carries no version: the card is whatever the document looks
 * like now, so an author's edit needs nothing curated here to follow it.
 *
 * A document earns a place here by being worth OPENING — the wall is a row of
 * links, not decoration, so every entry needs a title a stranger can act on
 * and a blurb that says what they are about to read.
 */

/** Where the featured documents actually live. */
export const SHOWCASE_ORIGIN = 'https://artifactbin.dev';

/** The shape a reader is about to open. Sets expectations before the click. */
export type ShowcaseKind = 'report' | 'deck' | 'dashboard' | 'data story' | 'product plan' | 'eda';

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
   * "You can use artifactbin to …". A use case with a real published
   * document under it is an argument; one without is a claim, which is why
   * this rides the showcase entry rather than living in its own list.
   *
   * KEEP IT SHORT. The wheel gives each phrase ONE line beside the stem and
   * truncates what does not fit — and a use case the reader cannot finish
   * reading is the one thing the wheel exists to say.
   */
  use: string;
}

/**
 * Curated, ordered — the wall reads left to right, so the strongest document
 * leads. Adding one is a single entry; there is no other file to touch.
 */
const ENTRIES: readonly ShowcaseDoc[] = [
  {
    order: 5,
    id: '5fN6kY',
    title: 'artifactbin · 90-Day Product Plan',
    blurb: 'A product plan connecting target outcomes, roadmap, milestones and architecture.',
    kind: 'product plan',
    use: 'create product plans people can align around',
  },
  {
    order: 2,
    id: 'YPLu0U',
    title: 'The OpenAI-Hugging Face incident',
    blurb: 'A reported piece with its own tables, published by an agent in one pass.',
    kind: 'report',
    use: 'write detailed incident reports',
  },
  {
    order: 4,
    id: 'wxeC8G',
    title: 'Vol 1: Built something cool? Show HN.',
    blurb: 'Fifteen years of Show HN: nine times the crowd, the same door.',
    kind: 'data story',
    use: 'tell compelling data stories',
  },
  {
    order: 6,
    id: 'EN6QaQ',
    placeholder: true,
    title: 'What is Artifactbin?',
    blurb: 'What is Artifactbin?',
    kind: 'deck',
    use: 'design polished presentations',
  },
  {
    order: 1,
    id: 'OewuPR',
    title: 'San Francisco City Payroll',
    blurb: 'A payroll dashboard whose tiles query the data in your own browser.',
    kind: 'dashboard',
    use: 'build interactive dashboards',
  },
  {
    order: 3,
    id: 'yKcybb',
    title: 'The best language for coding agents',
    blurb: 'Verifying claims on what language is best for coding agents.',
    kind: 'eda',
    use: 'perform exploratory data analysis',
  },
];

/** The wheel reads this, so `order` is the only thing that decides sequence. */
export const SHOWCASE: readonly ShowcaseDoc[] = [...ENTRIES].sort((a, b) => a.order - b.order);

/**
 * THE PLURAL FORM OF A KIND — the only part of the rail that is not derivable
 * from the entries themselves, so it is the only part written by hand, and it
 * lives HERE rather than in the component because this file is where a
 * showcased document's vocabulary is decided.
 */
const KIND_LABELS: Record<ShowcaseKind, string> = {
  dashboard: 'dashboards',
  report: 'reports',
  'data story': 'data stories',
  'product plan': 'product plans',
  deck: 'slides',
  eda: 'EDA'
};

/**
 * WHAT THE FORMAT RAIL NAMES — every kind the wall actually carries, once
 * each, IN THE WALL'S OWN ORDER. It was a hand-written list in the component
 * with an order of its own, which is exactly the drift this file exists to
 * prevent: reordering `ENTRIES` left the wheel and the rail beside it reading
 * two different sequences, silently. A kind is on the rail because a document
 * has it — adding one is still a single entry, with no second list to touch.
 */
export const SHOWCASE_FORMATS: readonly { kind: ShowcaseKind; label: string }[] = SHOWCASE.reduce<
  { kind: ShowcaseKind; label: string }[]
>((formats, doc) => {
  if (!formats.some((f) => f.kind === doc.kind)) formats.push({ kind: doc.kind, label: KIND_LABELS[doc.kind] });
  return formats;
}, []);

/** Where the card's click goes: the live document, on the instance that has it. */
export const showcaseHref = (doc: ShowcaseDoc): string => `${SHOWCASE_ORIGIN}/a/${doc.id}`;

/**
 * The document's own public capture — the picture IS the document. JPEG, as
 * the shelf's thumbnails are: the same wall in PNG measured 813 KB for ONE
 * card, for a picture that is never drawn wider than 380px.
 */
export const showcaseCardUrl = (doc: ShowcaseDoc): string =>
  `${SHOWCASE_ORIGIN}/a/${doc.id}/export?format=jpg&mode=card`;
