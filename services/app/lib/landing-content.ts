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


/**
 * THE TWO RENDERINGS OF THE ART. Every illustration exists as a solid felt-craft
 * render and as a watercolour of the same scene, and the landing carries both
 * so the two can be compared in place rather than described. The suffix IS the
 * variant — `beautiful.png` and `beautiful-water.png` — so a component picks a
 * rendering by naming one, and neither list can drift from the other.
 */
export type ArtVariant = 'felt' | 'water';

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
