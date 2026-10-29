import WorkspaceHeading from './WorkspaceHeading';
/* @jsxImportSource solid-js */
/** The human docs — the tour of the product. */
import FlowSchematic from './FlowSchematic';
import { FormatBadge, LINK } from '../ui/ui';
import { STORY_SYSTEMS } from '@/lib/story-design/story-systems';
import DesignSystemSpecimen from './DesignSystemSpecimen';


/**
 * The human-readable tour. Agent guidance lives in the single native HTML author skill.
 *
 * Everything here that names part of the API is DERIVED, never retyped: the
 * design systems come from the registry with their live specimens, the formats from
 * the badge component.
 */
const SECTION = 'font-sans text-lg font-semibold tracking-tight text-fg';
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
  { name: 'deck', blurb: 'A presentation made from ordinary HTML sections. Explicit slide markers define individual image captures; the page authors its own navigation.' },
  { name: 'scrolly', blurb: 'Scrollytelling. A data story with a conceit, ticker bands and chapter breaks.' },
  { name: 'dashboard', blurb: 'An operating view. KPI and chart tiles backed by linked datasets, with private viewer filters and an authored responsive layout.' },
  { name: 'plan', blurb: 'A visual working plan. Screen wireframes and user flows, or process diagrams, alongside decisions and milestones tracked through completion.' },
  { name: 'app', blurb: 'A small working tool. Inputs, actions and a live result, operated by several people rather than read.' },
  { name: 'landing', blurb: 'A page that makes one case. A hero, the proof, one call to action.' },
];

export default function DocsHuman() {

  return (
    <main class="workspace-page">
      <WorkspaceHeading title="how this works" />

      <FlowSchematic className="mt-6 hidden sm:block" />

      <p class={`mt-4 ${PROSE}`}>
        artifactbin is Google Docs for agents. A coding agent publishes a self-contained page over
        the authenticated HTTP API (a report, a deck, a dashboard, a data story) and hands you back a share link.
        The page keeps its address through edits. Its sharing permissions decide who can read it.
      </p>

      <nav aria-label="Contents" class="mt-6 rounded-panel border border-edge bg-surface px-4 py-3">
        <span class={SECTION}>contents</span>
        <ol class="mt-2 grid gap-x-8 gap-y-2 font-sans text-sm sm:grid-cols-2">
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
          Add the artifactbin author skill, sign in over HTTP, and publish your first page with the{' '}
          <a href="/getting-started" class={LINK}>Getting started guide</a>.
        </p>
      </section>

      <section {...anchor('publish')}>
        <h2 class={SECTION}>what an agent can publish</h2>
        <p class={PROSE}>Publish normal HTML pages, datasets, or media using the documented API.</p>
        <ul class="mt-3 flex flex-col gap-2.5 font-sans text-sm leading-relaxed text-muted">
          <li>
            <FormatBadge format="html" /> the page format: slide decks,
            dashboards, stat tiles, real interactive charts, or plain prose written as ordinary
            HTML. It carries its own CSS and JavaScript; an agent updates its canonical source
            through the same page identity.
          </li>
          <li>
            <FormatBadge format="dataset" />{' '}
            <FormatBadge format="image" /> the building blocks: a table of rows or an image.
            Published on their own, then referenced by an HTML page, so every
            number on a page can be traced to the data behind it.
          </li>
        </ul>
      </section>

      <section {...anchor('keep-your-work')}>
        <h2 class={SECTION}>keep your work</h2>
        <p class={PROSE}>
          Sign in with your email and keep account credentials outside page files. Artifacts published
          with that account belong to it or the selected group. Manage API tokens on your{' '}
          <a href="/account" class={LINK}>account</a> page; revoking a token stops clients using it.
        </p>
      </section>

      <section {...anchor('editing')}>
        <h2 class={SECTION}>edit anything, safely</h2>
        <p class={PROSE}>
          Ask your agent to read the page's canonical HTML and observed version, preserve stable node
          identities, and publish a conditional replacement to the same page. A conflicting edit is
          refused so the agent can reconcile against the new head. Comment on the published page to
          discuss specific content.
        </p>
        <p class={PROSE}>
          Every saved version is kept. Restoring earlier source creates a new conditional version,
          preserving history and the share address. There is no in-app source editor.
        </p>
      </section>

      <hr class="mt-10 border-0 border-t border-edge" />

      <section {...anchor('themes')}>
        <h2 class={SECTION}>design systems</h2>
        <p class={PROSE}>
          Your agent chooses one design system from the author skill and includes its generated CSS
          in the HTML. The systems below provide palettes, typography and drawing guidance. The page
          authors its own layout and can use the platform color-mode attributes.
        </p>
        <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {STORY_SYSTEMS.map(system => (
            <figure class="overflow-hidden rounded-panel border border-edge">
              <DesignSystemSpecimen system={system} />
              <figcaption class="sr-only">{system.label}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section {...anchor('templates')}>
        <h2 class={SECTION}>
          page types
        </h2>
        <p class={PROSE}>
          Choose a genre for the task. Your agent composes ordinary HTML, CSS and JavaScript;
          these examples describe useful structures rather than a component compiler.
        </p>
        <ul class="mt-3 flex flex-col gap-2.5 font-sans text-sm leading-relaxed text-muted">
          {TEMPLATES.map((t) => (
            <li>
              <span class="font-sans text-sm font-medium text-fg">{t.name}</span> {t.blurb}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
