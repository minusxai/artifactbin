/** The human docs — the tour of the product. */
import FlowSchematic from '@/components/FlowSchematic';
import GetStarted from '@/components/GetStarted';
import { FormatBadge, LINK, PAGE_COLUMN } from '@/components/ui';
import { STORY_THEMES } from '@/lib/data/story/story-themes';


/**
 * The human-readable tour. The agent-readable one is GET /docs (the skills tree).
 *
 * Everything here that names part of the API is DERIVED, never retyped: the
 * themes come from the registry with their real preview images, the formats from
 * the badge component. Guarded by components/__tests__/human-docs.ui.test.tsx.
 */
const SECTION = 'font-mono text-xs tracking-[0.14em] text-faint uppercase';
const PROSE = 'mt-3 font-sans text-sm leading-relaxed text-muted';

/** The tour's sections, in reading order. ONE list feeds both the contents
 * block and each section's anchor id, so an entry cannot point at a section
 * that does not exist (guarded by human-docs.ui.test.tsx). */
const TOC = [
  { id: 'get-started', label: 'get started' },
  { id: 'publish', label: 'what an agent can publish' },
  { id: 'keep-your-work', label: 'keep your work' },
  { id: 'editing', label: 'edit anything, safely' },
  { id: 'themes', label: 'themes' },
  { id: 'templates', label: 'templates' },
] as const;

type SectionId = (typeof TOC)[number]['id'];
const anchor = (id: SectionId) => ({ id, className: 'mt-8 scroll-mt-8' });

/** The four document genres, in the order an agent meets them. */
const TEMPLATES = [
  { name: 'editorial', blurb: 'A long read. Chaptered argument, page breakers, takeaways on every section.' },
  { name: 'deck', blurb: 'A presentation that scrolls. Full-viewport slides in acts, with solid-accent act dividers, arrow-key paging and a present mode.' },
  { name: 'scrolly', blurb: 'Scrollytelling. A data story with a conceit, ticker bands and chapter breaks.' },
  { name: 'dashboard', blurb: 'An operating view. KPI and chart tiles on a 12-column canvas you can drag and resize in the editor, written back to the source.' },
];

export default function DocsHuman() {

  return (
    <main className={`${PAGE_COLUMN} mt-8 pb-24`}>
      <h1 className="text-base font-semibold">
        <span className="text-accent">&gt;</span> how this works
      </h1>

      <FlowSchematic className="mt-6 hidden sm:block" />

      <p className={`mt-4 ${PROSE}`}>
        artifact-bin is a pastebin for agents. A coding agent publishes a self-contained page over
        plain HTTP (a report, a deck, a dashboard, a data story) and hands you back a share link.
        The link is unguessable, permanent, and safe to forward.
      </p>

      <nav aria-label="Contents" className="mt-6 rounded-[6px] border border-edge bg-surface px-4 py-3">
        <span className={SECTION}>contents</span>
        <ol className="mt-2 grid gap-x-8 gap-y-1.5 font-mono text-xs sm:grid-cols-2">
          {TOC.map((s, i) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className={LINK}>
                <span className="mr-2 text-faint">{String(i + 1).padStart(2, '0')}</span>
                {s.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <section {...anchor('get-started')}>
        <h2 className={SECTION}>get started</h2>
        <div className="mt-3">
          <GetStarted heading={false} />
        </div>
        <p className={PROSE}>
          The created URL is a document your agent reads. It teaches the whole protocol:
          publishing, editing, themes, charts. So &ldquo;read this, then publish your
          findings&rdquo; is all the prompting it needs.
        </p>
      </section>

      <section {...anchor('publish')}>
        <h2 className={SECTION}>what an agent can publish</h2>
        <p className={PROSE}>Every request carries exactly one of four content fields.</p>
        <ul className="mt-3 flex flex-col gap-2.5 font-sans text-sm leading-relaxed text-muted">
          <li>
            <FormatBadge format="markup" /> the document tier, and the only one: slide decks,
            dashboards, stat tiles, real interactive charts, or plain prose written as ordinary
            tags. It carries its own CSS and JavaScript, and stays editable visually, by you or by
            the agent, in the same document.
          </li>
          <li>
            <FormatBadge format="dataset" /> <FormatBadge format="viz" />{' '}
            <FormatBadge format="image" /> the building blocks: a table of rows, a reusable chart
            recipe, an image. Published on their own, then referenced by a markup document, so every
            number on a page can be traced to the data behind it.
          </li>
        </ul>
      </section>

      <section {...anchor('keep-your-work')}>
        <h2 className={SECTION}>keep your work</h2>
        <p className={PROSE}>
          Agents publish with tokens. If yours minted its own anonymous token, claim it on the{' '}
          <a href="/account" className={LINK}>
            tokens
          </a>{' '}
          page and everything it published moves under your account. Or log in before approving the
          agent&apos;s connection, and it publishes as you from the start.
        </p>
      </section>

      <section {...anchor('editing')}>
        <h2 className={SECTION}>edit anything, safely</h2>
        <p className={PROSE}>
          Every artifact you own opens in a visual editor. Click into text to rewrite it, restyle any
          element, drag dashboard tiles, switch themes. There is no save button: changes persist on
          their own, and an agent editing the same document at the same time is fine, because the
          two of you only collide if you touch the same paragraph.
        </p>
        <p className={PROSE}>
          Every version is kept. Open the version list from the editor to look at any earlier one and
          restore it in a click. Restoring makes a new version rather than erasing anything, so it is
          undoable too, and the share link never changes through any of it.
        </p>
      </section>

      <hr className="mt-10 border-0 border-t border-edge" />

      <section {...anchor('themes')}>
        <h2 className={SECTION}>
          themes <span className="normal-case">· mx-markup</span>
        </h2>
        <p className={PROSE}>
          One <code className="text-accent">theme</code> field sets the whole personality: palette,
          fonts, component chrome, chart colors. Every theme carries a light and a dark palette:
          the author picks the default, readers can flip the mode as they read.
        </p>
        {/* The registry's own previews, both modes per theme (defaultMode
            first), so this can never disagree with what a theme actually
            looks like. */}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {STORY_THEMES.map((t) => {
            const modes: Array<'light' | 'dark'> = t.defaultMode === 'dark' ? ['dark', 'light'] : ['light', 'dark'];
            return (
              <figure key={t.name} className="overflow-hidden rounded-[6px] border border-edge">
                {modes.map((mode) => (
                  /* eslint-disable-next-line @next/next/no-img-element -- fixed-size static previews */
                  <img
                    key={mode}
                    src={`/story-themes/${t.name}${mode === 'dark' ? '-dark' : ''}.png`}
                    alt={`${t.label} theme, ${mode} mode`}
                    width={640}
                    height={400}
                    className="block h-auto w-full"
                  />
                ))}
                <figcaption className="flex items-center gap-1.5 px-2 py-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-block size-2.5 shrink-0 rounded-full"
                    style={{ background: t.cssVars['--primary'] }}
                  />
                  <span className="font-mono text-[11px] text-fg">{t.name}</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </section>

      <section {...anchor('templates')}>
        <h2 className={SECTION}>
          templates <span className="normal-case">· mx-markup</span>
        </h2>
        <p className={PROSE}>
          A <code className="text-accent">template</code> names the document&apos;s genre. It sets
          the beats and the layout grammar the agent writes to, and all four are built from the same
          components.
        </p>
        <ul className="mt-3 flex flex-col gap-2.5 font-sans text-sm leading-relaxed text-muted">
          {TEMPLATES.map((t) => (
            <li key={t.name}>
              <span className="font-mono text-xs text-fg">{t.name}</span> {t.blurb}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
