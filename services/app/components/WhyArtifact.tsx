'use client';

/**
 * WHY ARTIFACT-BIN — an ANATOMY PLATE: one artifact, with the four claims
 * pinned onto the parts of it that are the claims.
 *
 * Two designs preceded this and both failed the same way. A 2×2 of rounded
 * cards was the default generated feature grid. Replacing it with a datasheet
 * fixed the vocabulary but not the argument — four rows of equal weight, every
 * one an assertion. Giving each row its own animated vignette (the pass right
 * before this) was worse in a way that only showed on screen: four boxes of
 * identical size, two of them empty for most of their loop, which reads as a
 * page that failed to load. Four figures is four things to look at, so nothing
 * is looked at.
 *
 * So: ONE thing to look at. A real-looking document sits under its own share
 * link, and the app's own annotations — a numbered pin, a caret, a comment
 * card, a token counter — point INTO it. The claims below are a key to the
 * plate, the way a diagram is keyed. That ranks the section (one hero, four
 * captions), and it is the honest picture of the product: all four claims are
 * true of the SAME document at the SAME time, which is the actual argument
 * against a gist. Numbering earns its place here as a figure key — pin n on
 * the plate, entry n in the key — not as a fake sequence.
 *
 * WHAT IS THE DOCUMENT AND WHAT IS THE APP is the detail that makes it read:
 * the page, its type and its chart are the THEME's tokens, straight off the
 * registry; the pins, the caret, the comment card and the token chip are app
 * chrome in the app's green. That is exactly how the real product composes —
 * annotations float over a document they are not part of — so the plate is a
 * picture of the thing rather than a drawing of it.
 *
 * ONE timeline, not four: the key cycles, and only the live claim's part of the
 * document does anything. The document repaints through the real palettes only
 * while "beautiful by default" is the live claim, so the flip is caused by the
 * claim rather than running underneath it. Hover or focus holds the cycle where
 * it is; a click pins it. Under reduced motion nothing moves and every claim's
 * evidence is shown at once — the frozen frame is the legible one, not a
 * slower version of the loop.
 */
import { useEffect, useState } from 'react';
import { STORY_THEMES } from '@/lib/data/story/story-themes';
import { REASONS, type Reason, type ReasonDemo } from '@/lib/landing-content';

const EYEBROW = 'font-mono text-[10px] uppercase tracking-[0.14em] text-faint';
/**
 * PARKED, NOT DEAD. The illustrated band (FeatureSpecimens) holds the landing's
 * features slot while the two art renderings are being chosen between; this
 * plate is the other candidate for it and is kept working.
 *
 * It carries only the claims the mock document can ACT OUT. A claim about what
 * is outside the document — "any agent, one link" — has no part of the page to
 * pin, which is why `demo` is optional on Reason and why this list is derived
 * rather than assumed to be all of REASONS.
 */
const PLATED = REASONS.filter((r): r is Reason & { demo: ReasonDemo } => Boolean(r.demo));
/** How long a claim holds the document before the key moves on. */
const STEP_MS = 4200;
/** How fast the document repaints while the theme claim is live. */
const THEME_MS = 1150;
/**
 * The beats INSIDE a step, in ms from the moment it goes live. Sub-state is
 * the number of marks passed, so a step's render reads `shown(n)` and the
 * timing lives here in one table rather than in four components.
 */
const BEATS: Record<ReasonDemo, readonly number[]> = {
  // The saving lands after the eye has found the query line it is about.
  tokens: [650],
  // The palette does the talking; nothing else in this step.
  themes: [],
  // select → the three characters → the confirmation.
  edit: [450, 950, 1120, 1290, 1800],
  // The open question is always on the document; the step brings the answer.
  annotate: [900, 2300],
};
/** The document's own copy. The numbers are the ones the claims talk about. */
const DOC = {
  address: 'artifactbin.dev/a/9kQ2vX',
  title: 'Q3 revenue review',
  meta: 'published by your agent · v4',
  before: '21%',
  after: '24%',
  annotated: '$4M',
  // Short enough to be READ at 10px beside the saving it is the reason for —
  // the full `group by` tail only bought an ellipsis.
  sql: 'select month, sum(arr) from ref_9kQ2vX',
  // The chart the query above returns: one series, six months to the quarter
  // the document is about. Labelled, because an unlabelled bar row is a motif.
  bars: [
    { month: 'apr', height: 0.42 },
    { month: 'may', height: 0.58 },
    { month: 'jun', height: 0.5 },
    { month: 'jul', height: 0.74 },
    { month: 'aug', height: 0.66 },
    { month: 'sep', height: 1 },
  ],
} as const;

type Theme = (typeof STORY_THEMES)[number];

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The theme's own faces, degrading to the right FAMILY rather than to the
 * app's: a manuscript theme previewing in a grotesque is a lie about the
 * registry. Only the app's two faces are actually loaded here, so the fallback
 * is what most readers see, and it must at least keep the serif serif.
 */
const stackFor = (face: string | undefined): string => {
  if (!face) return 'var(--font-sans)';
  if (face === 'JetBrains Mono') return `'${face}', ui-monospace, monospace`;
  if (face === 'Noto Serif' || face === 'Cormorant Garamond') return `'${face}', Georgia, serif`;
  return `'${face}', var(--font-sans)`;
};

/** A theme's tokens for the mode it was designed in. */
const varsFor = (theme: Theme): Record<string, string> =>
  theme.defaultMode === 'dark' ? { ...theme.cssVars, ...theme.darkCssVars } : theme.cssVars;

/** The plate's pin: app chrome, so it never takes the document's colours. */
function Pin({ n, title, on }: { n: number; title: string; on: boolean }) {
  return (
    <span
      aria-label={`Pin ${n}: ${title}`}
      role="img"
      className={`inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full border font-mono text-[8.5px] leading-none font-semibold transition-colors duration-300 ${
        on ? 'border-accent bg-accent text-bg' : 'border-edge-bright bg-bg text-faint'
      }`}
    >
      {n}
    </span>
  );
}

export default function WhyArtifact() {
  const [reduced] = useState(prefersReducedMotion);
  const [active, setActive] = useState(0);
  const [sub, setSub] = useState(0);
  const [held, setHeld] = useState(false);
  const [themeIndex, setThemeIndex] = useState(4);

  // The key advances. Keyed on `active`, so picking a claim buys a full step
  // rather than the tail of the one it interrupted.
  useEffect(() => {
    if (reduced || held) return;
    const id = setTimeout(() => setActive((a) => (a + 1) % PLATED.length), STEP_MS);
    return () => clearTimeout(id);
  }, [active, held, reduced]);

  // The live step's own beats.
  useEffect(() => {
    if (reduced) return;
    setSub(0);
    const ids = BEATS[PLATED[active].demo].map((at, i) => setTimeout(() => setSub(i + 1), at));
    return () => ids.forEach(clearTimeout);
  }, [active, reduced]);

  // The document repaints only while the theme claim holds it.
  useEffect(() => {
    if (reduced || PLATED[active].demo !== 'themes') return;
    const id = setInterval(() => setThemeIndex((t) => (t + 1) % STORY_THEMES.length), THEME_MS);
    return () => clearInterval(id);
  }, [active, reduced]);

  const theme = STORY_THEMES[themeIndex];
  const vars = varsFor(theme);
  // The theme's radius, at the miniature's scale and capped by the plate's own.
  const radius = Math.min(Math.round(parseFloat(vars['--radius'] ?? '0') * 16 * 0.7), 10);
  /** Is this claim holding the document right now? Never under reduced motion. */
  const live = (demo: ReasonDemo) => !reduced && PLATED[active].demo === demo;
  /** Has this claim's nth beat landed? Frozen motion shows every end state. */
  const shown = (demo: ReasonDemo, n: number) => reduced || (live(demo) && sub >= n);
  /**
   * The ring that marks the part of the document under discussion. Mostly
   * OUTLINE and barely any fill: the app's green over a document painted in the
   * theme's own primary is two accents in one box, and a solid tint fought
   * every warm palette in the registry.
   */
  const mark = (demo: ReasonDemo) =>
    live(demo) ? 'bg-accent/10 outline outline-1 outline-accent/70' : 'outline-none';

  const pick = (i: number) => setActive(i);

  return (
    <div
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <h2 className={EYEBROW}>why artifactbin</h2>
      <p className="mt-2 font-mono text-[clamp(1rem,1.9vw,1.25rem)] leading-snug font-semibold tracking-[-0.02em] text-fg">
        Anatomy of an artifact
      </p>
      <p className="mt-1.5 max-w-xl font-sans text-[13.5px] leading-relaxed text-muted">
        One document, doing four things a gist, a notebook or a file in a bucket cannot.
      </p>

      {/* THE PLATE. The frame is the app's; everything inside the address bar
        * is the document's own theme. */}
      <figure
        aria-label="The document these claims are about"
        className="mt-5 mb-0 overflow-hidden rounded-[8px] border border-edge bg-surface shadow-[0_18px_40px_-28px_rgba(0,0,0,0.45)]"
      >
        {/* The share link IS the product's payoff, so the document wears it
          * rather than a set of fake window controls. */}
        <div className="flex items-center gap-2 border-b border-edge bg-raised px-3 py-2">
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted">
            {DOC.address}
          </span>
          {/* The six real palettes, as the document's own control. Clicking one
            * restyles the page and hands the theme claim the plate. */}
          <span className="flex shrink-0 items-center gap-1">
            {STORY_THEMES.map((entry, i) => (
              <button
                key={entry.name}
                aria-label={`Restyle in the ${entry.label} theme`}
                aria-pressed={i === themeIndex}
                onClick={() => {
                  setThemeIndex(i);
                  pick(PLATED.findIndex((r) => r.demo === 'themes'));
                }}
                className={`h-3.5 w-3.5 cursor-pointer rounded-[3px] border p-0 transition-transform ${
                  i === themeIndex
                    ? 'scale-115 border-accent'
                    : 'border-edge-bright opacity-70 hover:opacity-100'
                }`}
                style={{ background: entry.cssVars['--primary'] }}
              />
            ))}
          </span>
        </div>

        {/* The document. Every colour, radius and face below is the theme's. */}
        <div
          className="relative px-4 py-4 transition-[background-color,color] duration-500 motion-reduce:transition-none sm:px-6 sm:py-5"
          style={{ background: vars['--background'], color: vars['--foreground'] }}
        >
          {/* Only the TEXT clears the floating thread. The chart and the query
            * line below run the document's full width, the way they would in a
            * real one — reserving the margin down the whole page left a column
            * of nothing under the card. */}
          <div className="sm:pr-[186px]">
            <h3
              className="m-0 flex items-center gap-2 text-[17px] leading-tight font-semibold sm:text-[19px]"
              style={{ fontFamily: stackFor(theme.fonts.display) }}
            >
              <span className={`rounded-[3px] px-1 -mx-1 ${mark('themes')}`}>{DOC.title}</span>
              <Pin n={2} title={PLATED[1].title} on={live('themes')} />
            </h3>
            <p
              className="mt-1 mb-0 font-mono text-[9.5px] tracking-wide uppercase transition-colors duration-500 motion-reduce:transition-none"
              style={{ color: vars['--muted-foreground'] }}
            >
              {DOC.meta}
            </p>

            <p
              className="mt-3 mb-0 text-[13.5px] leading-[1.7] sm:text-[14px]"
              style={{ fontFamily: stackFor(theme.fonts.body) }}
            >
              Enterprise ARR passed{' '}
              {/* The annotated phrase. The pin rides the words it is about. */}
              <span className={`rounded-[3px] px-0.5 ${mark('annotate')}`}>
                {DOC.annotated}
                <span className="ml-0.5 inline-flex translate-y-[-4px] align-baseline">
                  <Pin n={4} title={PLATED[3].title} on={live('annotate')} />
                </span>
              </span>{' '}
              in June. Revenue grew{' '}
              {/* The edited number: selected, retyped, confirmed. */}
              <span className={`rounded-[3px] px-0.5 ${mark('edit')}`}>
                {!shown('edit', 1) && DOC.before}
                {live('edit') && sub === 1 && (
                  <span className="rounded-[2px] bg-accent/40">{DOC.before}</span>
                )}
                {shown('edit', 2) && (
                  <span className={shown('edit', 5) ? 'font-semibold text-accent' : ''}>
                    {DOC.after.slice(0, reduced ? 3 : Math.min(sub - 1, 3))}
                    {live('edit') && sub < 5 && (
                      <span
                        aria-hidden
                        className="caret ml-px inline-block h-[13px] w-[6px] translate-y-[2px] bg-accent"
                      />
                    )}
                  </span>
                )}
                <span className="ml-0.5 inline-flex translate-y-[-4px] align-baseline">
                  <Pin n={3} title={PLATED[2].title} on={live('edit')} />
                </span>
              </span>{' '}
              in Q3, led by expansion.
            </p>
          </div>

          <div>
            {/* The chart, in the theme's own primary. ONE series ramping to the
              * current month — a bar per chart token was six unrelated colours,
              * which is not what a designed chart looks like and made the plate
              * read as swatches rather than as a document. The heights never
              * move, so only the palette is doing anything. */}
            <div aria-hidden className="mt-4 flex h-16 items-end gap-2 sm:h-[72px]">
              {DOC.bars.map((bar, i) => (
                <span
                  key={bar.month}
                  className="flex-1 transition-[background-color] duration-500 motion-reduce:transition-none"
                  style={{
                    height: `${bar.height * 100}%`,
                    background: vars['--primary'],
                    opacity: 0.4 + (i / (DOC.bars.length - 1)) * 0.6,
                    borderRadius: `${Math.min(radius, 4)}px`,
                  }}
                />
              ))}
            </div>
            <div
              className="h-px w-full transition-colors duration-500 motion-reduce:transition-none"
              style={{ background: vars['--border'] }}
            />
            <div aria-hidden className="mt-1 flex gap-2">
              {DOC.bars.map((bar) => (
                <span
                  key={bar.month}
                  className="flex-1 text-center font-mono text-[8.5px] tracking-wide transition-colors duration-500 motion-reduce:transition-none"
                  style={{ color: vars['--muted-foreground'] }}
                >
                  {bar.month}
                </span>
              ))}
            </div>

            {/* What the chart above actually is: a query, not four thousand
              * rows of pasted data. */}
            <div
              className={`mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[4px] px-2 py-1.5 ${mark('tokens')}`}
              style={{ background: live('tokens') ? undefined : vars['--muted'] }}
            >
              <Pin n={1} title={PLATED[0].title} on={live('tokens')} />
              <code
                className="min-w-0 flex-1 truncate font-mono text-[10px] transition-colors duration-500 motion-reduce:transition-none"
                style={{ color: vars['--muted-foreground'] }}
              >
                <span style={{ color: vars['--primary'] }}>&lt;Query&gt;</span> {DOC.sql}
              </code>
              <span
                className={`w-full shrink-0 text-right font-mono text-[9.5px] whitespace-nowrap text-accent transition-opacity duration-300 sm:w-auto ${
                  shown('tokens', 1) ? 'opacity-100' : 'opacity-0'
                }`}
              >
                4,100 tokens · 41,000 saved
              </span>
            </div>
          </div>

          {/* The annotation thread: APP chrome floating over the document's
            * right edge, which is where the real one lives. In flow on a phone,
            * where there is no margin to float in.
            *
            * IT IS ALWAYS THERE. Mounting it only while its own claim was live
            * left the reserved margin empty for three quarters of the loop —
            * the dead-box failure the four-vignette pass died of, reintroduced
            * in one corner. An open thread persists on a real document, so the
            * question stands and the step brings the ANSWER. */}
          <div
            className={`mt-3 rounded-[6px] border bg-comment px-2.5 py-2 transition-colors duration-300 sm:absolute sm:top-[84px] sm:right-4 sm:mt-0 sm:w-[168px] sm:shadow-[0_6px_20px_-10px_rgba(0,0,0,0.45)] ${
              live('annotate') ? 'border-accent' : 'border-edge'
            }`}
          >
            <span className="flex items-baseline gap-1.5">
              <span className="font-mono text-[8.5px] tracking-[0.12em] text-faint uppercase">
                you
              </span>
              <span className="font-sans text-[11.5px] leading-snug text-fg">
                Is this the June number?
              </span>
            </span>
            {/* The answer and the resolution GROW the card rather than fading
              * into space kept for them: a thread reserving two blank rows is a
              * card that looks broken for as long as it is waiting, which is
              * most of the loop. Collapsing rows (0fr → 1fr) animate without a
              * measured height. */}
            <span
              className={`grid transition-[grid-template-rows] duration-400 ease-out motion-reduce:transition-none ${
                shown('annotate', 1) ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
              }`}
            >
              <span className="min-h-0 overflow-hidden">
                <span className="mt-1.5 flex items-baseline gap-1.5">
                  <span className="font-mono text-[8.5px] tracking-[0.12em] text-accent uppercase">
                    agent
                  </span>
                  <span className="font-sans text-[11.5px] leading-snug text-fg">
                    Re-ran the query — fixed.
                  </span>
                </span>
              </span>
            </span>
            <span
              className={`grid transition-[grid-template-rows] duration-400 ease-out motion-reduce:transition-none ${
                shown('annotate', 2) ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
              }`}
            >
              <span className="min-h-0 overflow-hidden">
                <span className="mt-1.5 block font-mono text-[9.5px] text-accent">✓ resolved</span>
              </span>
            </span>
          </div>
        </div>
      </figure>

      {/* THE KEY. Numbered to the pins above; the live entry holds the plate. */}
      <ol
        aria-label="What the document above demonstrates"
        className="mt-5 grid list-none grid-cols-1 gap-x-8 border-t border-edge p-0 sm:grid-cols-2"
      >
        {PLATED.map((reason, i) => {
          const on = !reduced && i === active;
          return (
            <li
              key={reason.title}
              aria-label={reason.title}
              onMouseEnter={() => pick(i)}
              onFocus={() => pick(i)}
              tabIndex={0}
              className={`m-0 flex cursor-default flex-col gap-1.5 border-b border-edge py-4 transition-colors focus:outline-none ${
                i % 2 === 0 ? 'sm:border-r sm:border-edge sm:pr-8' : 'sm:pl-8'
              }`}
            >
              <span className="flex items-center gap-2">
                <Pin n={i + 1} title={reason.title} on={on} />
                <span
                  className={`font-mono text-[11px] font-semibold tracking-[0.16em] uppercase transition-colors ${
                    on ? 'text-accent' : 'text-fg'
                  }`}
                >
                  {reason.title}
                </span>
              </span>
              <p className="m-0 font-sans text-[13.5px] leading-[1.6] text-fg">{reason.body}</p>
              <p className="m-0 mt-auto pt-1 font-mono text-[10.5px] leading-relaxed text-muted">
                <span aria-hidden className="text-accent">
                  ›››&nbsp;
                </span>
                {reason.proof}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
