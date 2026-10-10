/* @jsxImportSource solid-js */
/** The human docs — the tour of the product. */
import FlowSchematic from './FlowSchematic';
import { FormatBadge, LINK } from '../ui/ui';
import { STORY_SYSTEMS } from '@/lib/data/story/story-systems';
import DesignSystemSpecimen from './DesignSystemSpecimen';


/**
 * The human-readable tour. Agent guidance is installed locally by the CLI.
 *
 * Everything here that names part of the API is DERIVED, never retyped: the
 * design systems come from the registry with their live specimens, the formats from
 * the badge component.
 */
const SECTION = 'font-mono text-xs tracking-[0.14em] text-faint uppercase';
const PROSE = 'mt-3 font-sans text-sm leading-relaxed text-muted';

/** The tour's sections, in reading order. ONE list feeds both the contents
 * block and each section's anchor id, so an entry cannot point at a section
 * that does not exist */
const TOC = [
  { id: 'get-started', label: 'get started' },
  { id: 'publish', label: 'what an agent can publish' },
  { id: 'keep-your-work', label: 'keep your work' },
  { id: 'editing', label: 'edit anything, safely' },
  { id: 'themes', label: 'design systems' },
  { id: 'templates', label: 'templates' },
] as const;

type SectionId = (typeof TOC)[number]['id'];
const anchor = (id: SectionId) => ({ id, class: 'mt-8 scroll-mt-8' });

/** The document genres, in the order an agent meets them. */
const TEMPLATES = [
  { name: 'editorial', blurb: 'A long read. Chaptered argument, page breakers, takeaways on every section.' },
  { name: 'deck', blurb: 'A presentation that scrolls. Full-viewport slides in acts, with solid-accent act dividers, arrow-key paging and a present mode.' },
  { name: 'scrolly', blurb: 'Scrollytelling. A data story with a conceit, ticker bands and chapter breaks.' },
  { name: 'dashboard', blurb: 'An operating view. KPI and chart tiles on a 12-column canvas you can drag and resize in the editor, written back to the source.' },
  { name: 'plan', blurb: 'A visual working plan. Screen wireframes and user flows, or process diagrams, alongside decisions and milestones tracked through completion.' },
  { name: 'app', blurb: 'A small working tool. Inputs, actions and a live result, operated by several people rather than read.' },
  { name: 'landing', blurb: 'A page that makes one case. A hero, the proof, one call to action.' },
];

export default function DocsHuman() {

  return (
    <main class="workspace-page">
      <h1 class="text-base font-semibold">
        <span class="text-accent">&gt;</span> how this works
      </h1>

      <FlowSchematic className="mt-6 hidden sm:block" />

      <p class={`mt-4 ${PROSE}`}>
        artifactbin is Google Docs for agents. A coding agent publishes a self-contained page over
        the CLI (a report, a deck, a dashboard, a data story) and hands you back a share link.
        The link is unguessable, permanent, and safe to forward.
      </p>

      <nav aria-label="Contents" class="mt-6 rounded-[6px] border border-edge bg-surface px-4 py-3">
        <span class={SECTION}>contents</span>
        <ol class="mt-2 grid gap-x-8 gap-y-1.5 font-mono text-xs sm:grid-cols-2">
          {TOC.map((s, i) => (
            <li>
              <a href={`#${s.id}`} class={LINK}>
                <span class="mr-2 text-faint">{String(i + 1).padStart(2, '0')}</span>
                {s.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <section {...anchor('get-started')}>
        <h2 class={SECTION}>get started</h2>
        <p class={PROSE}>
          Install afbin, connect your agent, and make your first edit with the{' '}
          <a href="/getting-started" class={LINK}>Getting started guide</a>.
        </p>
      </section>

      <section {...anchor('publish')}>
        <h2 class={SECTION}>what an agent can publish</h2>
        <p class={PROSE}>Every request carries exactly one of four content fields.</p>
        <ul class="mt-3 flex flex-col gap-2.5 font-sans text-sm leading-relaxed text-muted">
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
        <h2 class={SECTION}>keep your work</h2>
        <p class={PROSE}>
          Log in before you approve the agent&apos;s connection, and everything it publishes belongs
          to your account from the start. Every connection you have approved is listed on your{' '}
          <a href="/account" class={LINK}>
            account
          </a>{' '}
          page, where revoking one stops that agent.
        </p>
      </section>

      <section {...anchor('editing')}>
        <h2 class={SECTION}>edit anything, safely</h2>
        <p class={PROSE}>
          Every artifact you own opens in a visual editor. Click into text to rewrite it, restyle any
          element, drag dashboard tiles, switch themes. There is no save button: changes persist on
          their own, and an agent editing the same document at the same time is fine, because the
          two of you only collide if you touch the same paragraph.
        </p>
        <p class={PROSE}>
          Every version is kept. Open the version list from the editor to look at any earlier one and
          restore it in a click. Restoring makes a new version rather than erasing anything, so it is
          undoable too, and the share link never changes through any of it.
        </p>
      </section>

      <hr class="mt-10 border-0 border-t border-edge" />

      <section {...anchor('themes')}>
        <h2 class={SECTION}>design systems</h2>
        <p class={PROSE}>
          One <code class="text-accent">theme</code> field selects a design system: its palette,
          typography, components and drawing style. Every system carries a light and a dark palette.
          Choose a system in the editor; readers can flip the color mode as they read.
          Older documents can keep their legacy themes.
        </p>
        <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {STORY_SYSTEMS.map(system => (
            <figure class="overflow-hidden rounded-[6px] border border-edge">
              <DesignSystemSpecimen system={system} />
              <figcaption class="sr-only">{system.label}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section {...anchor('templates')}>
        <h2 class={SECTION}>
          templates <span class="normal-case">· mx-markup</span>
        </h2>
        <p class={PROSE}>
          A <code class="text-accent">template</code> names the document&apos;s genre. It sets
          the beats and the layout grammar the agent writes to, and all are built from the same
          components.
        </p>
        <ul class="mt-3 flex flex-col gap-2.5 font-sans text-sm leading-relaxed text-muted">
          {TEMPLATES.map((t) => (
            <li>
              <span class="font-mono text-xs text-fg">{t.name}</span> {t.blurb}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
