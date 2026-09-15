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
 * and a kind that says what they are about to open.
 */

/** Where the featured documents actually live. */
export const SHOWCASE_ORIGIN = 'https://artifactbin.dev';
/** Canonical card exports redirect here for image delivery. */
export const SHOWCASE_ASSETS_ORIGIN = 'https://a.artifactbin.dev';

/** The shape a reader is about to open. Sets expectations before the click. */
export type ShowcaseKind = 'report' | 'deck' | 'dashboard' | 'data story' | 'product plan' | 'eda' | 'animation' | 'maps' | 'coding agent plan' | 'micro app';

interface ShowcaseDoc {
  order: number;
  id: string;
  placeholder?: true;
  title: string;
  kind: ShowcaseKind;
}

/**
 * Curated, ordered — the wall reads left to right, so the strongest document
 * leads. Adding one is a single entry; there is no other file to touch.
 */
const ENTRIES: readonly ShowcaseDoc[] = [
  {
    order: 5,
    id: 'iTlSrH',
    title: 'A little way from home',
    kind: 'animation',
  },
  {
    order: 2,
    id: 'YPLu0U',
    title: 'The OpenAI-Hugging Face incident',
    kind: 'report',
  },
  {
    order: 4,
    id: 'wxeC8G',
    title: 'Vol 1: Built something cool? Show HN.',
    kind: 'data story',
  },
  {
    order: 6,
    id: 'Pej96A',
    title: 'SF road network',
    kind: 'maps',
  },
  {
    order: 1,
    id: 'OewuPR',
    title: 'SF City Payroll',
    kind: 'dashboard',
  },
  {
    order: 3,
    id: 'HrjNbY',
    title: 'The best language for coding agents',
    kind: 'eda',
  },
  {
    order: 7,
    id: "gb7wpH",
    title: "Homepage Redesign",
    kind: "coding agent plan"
  },
  {
    order: 8,
    id: "5fN6kY",
    title: "Artifactbin 90-day product plan",
    kind: 'product plan'
  },
  {
    order: 9,
    id: "HLAUdN",
    title: "Weightloss with friends",
    kind: "micro app"
  },
  {
    order: 10,
    id: "oHmbko",
    title: "Badminton today?",
    kind: "micro app"
  }
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
  eda: 'EDA',
  animation: 'animations',
  maps: 'maps',
  'coding agent plan': 'coding agent plan',
  'micro app': 'micro app'
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
