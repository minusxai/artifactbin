/**
 * The /a/:id reader HYDRATES the server's render instead of drawing it again.
 *
 * One composition on both sides (lib/story-runtime/inline-composition) is what
 * makes that match by construction: the server renders it to a string
 * (ssr-entry renderInlineStory), the browser hydrates the same tree with the
 * same props, and React keeps every server node. Any hydration error or
 * warning — structural (#418) or attribute-only (generated ids, styles), which
 * React 19 leaves WRONG in the page — fails here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { compiledSource, type TestSource } from '@/test/helpers/compiled';
import { STORY_DOCUMENT_MESSAGE, STORY_READER_MODE_MESSAGE, type StoryIslandData } from '../contract';
import { InlineStoryComposition } from '../inline-composition';
import { inlineStoryCss, inlineStoryNodes } from '@/lib/story/inline-css';
import { InlineStoryRuntime, type InlineStoryController } from '../InlineStoryRuntime';
import { renderInlineStory } from '../ssr-entry';
import { storyBodyFor } from '@/lib/story/body';
import { glyphsForNodes } from '@/lib/story/icon-glyphs';
import { servedStoryHtml } from '@/lib/story/inline-story-html';
import type { ServedStoryRuntime } from '@/lib/story/prepared-runtime';
import { storyBaseCss, type StoryBaseCssRecipe } from '@/lib/story/story-base-css';
import { styleOverrides } from '@/lib/story/style-overrides';
import { captureInitialStory, clearInitialStory } from '@/web/initial-story';

const KIT = `<article>
  <h1>Hydrate me</h1>
  <Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger><TabsTrigger value="two">Two</TabsTrigger></TabsList>
    <TabsContent value="one"><p>first</p></TabsContent><TabsContent value="two"><p>second</p></TabsContent></Tabs>
  <Accordion type="single" collapsible><AccordionItem value="a"><AccordionTrigger>Open</AccordionTrigger><AccordionContent>inside</AccordionContent></AccordionItem></Accordion>
  <Card><CardHeader><CardTitle>Card</CardTitle></CardHeader><CardContent>body</CardContent></Card>
</article>`;

const data = (source: string): StoryIslandData => ({ nodes: parseJsxOrThrow(source).nodes, refData: {}, colorMode: 'light', template: 'editorial' } as StoryIslandData);
const CSS = { baseCss: 'body{margin:0}', compiledCss: '.x{color:red}', authorCss: '.kpi{letter-spacing:-0.02em}' };

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('the inline reader hydrates the server render', () => {
  it('hydrates a kit document with no error, no warning, and keeps the server nodes', async () => {
    const d = data(KIT);
    const css = inlineStoryCss(CSS);
    const host = document.createElement('div');
    host.innerHTML = renderInlineStory(d, css);
    document.body.appendChild(host);
    const serverNodes = [...host.querySelectorAll('*')];
    const errors: unknown[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args); });
    await act(async () => {
      hydrateRoot(host, <InlineStoryComposition data={d} css={css} />, {
        onRecoverableError: (e) => errors.push(e), onCaughtError: (e) => errors.push(e), onUncaughtError: (e) => errors.push(e),
      });
    });
    expect(errors).toEqual([]);
    // Every element the server drew is still the element in the page.
    expect(serverNodes.every((n) => host.contains(n))).toBe(true);
    // Generated ids agree: every aria-controls names an element that exists.
    for (const el of host.querySelectorAll('[aria-controls]')) {
      expect(document.getElementById(el.getAttribute('aria-controls')!), el.outerHTML).not.toBeNull();
    }
  });
});

describe('one CSS assembly for both sides', () => {
  it('can never close its <style> from inside author CSS', () => {
    const css = inlineStoryCss({ ...CSS, authorCss: '.a{} </style><script>alert(1)</script>' });
    expect(css.toLowerCase()).not.toContain('</style');
  });

  it('skips missing parts without leaving blank separators, identically every time', () => {
    const a = inlineStoryCss({ baseCss: 'b{}', compiledCss: null, authorCss: null });
    expect(a).toBe(inlineStoryCss({ baseCss: 'b{}', compiledCss: '', authorCss: '' }));
  });
});

/*
 * THE PRODUCT PATH. The page the server builds (lib/story/inline-story-html,
 * as server/app withInitialStory places it), captured before the app mounts
 * (web/initial-story), and the reader's real InlineStoryRuntime adopting it with
 * a live store, a transport and its asset relay — every divergence the
 * store-less composition above cannot see. React's development build reports
 * attribute-only mismatches here (console.error); the browser gate runs a
 * production build, which does not, so THIS matrix is where those are caught.
 */
const FIXTURES = path.resolve(process.cwd(), '../../scripts/fixtures/page-speed');
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8');
const SALES = 'SaLes1';
const SALES_COLUMNS = [{ name: 'month', type: 'date' }, { name: 'region', type: 'string' }, { name: 'product', type: 'string' }, { name: 'revenue', type: 'number' }, { name: 'units', type: 'number' }] as const;

interface Serve { colorMode?: 'light' | 'dark'; template?: string | null; viewer?: StoryIslandData['viewer']; readOnly?: string; refData?: StoryIslandData['refData']; theme?: ServedStoryRuntime['theme']; sources?: Record<string, TestSource> }
type Served = ServedStoryRuntime & { css: string; raw: { compiledCss: string | null; authorCss: string | null } };
/** What the reader page is sent (lib/story/prepared-page.server): the sheet and style values already isolated on the server. */
async function served(source: string, opts: Serve = {}): Promise<Served> {
  const split = storyBodyFor(source);
  if (!split) throw new Error('fixture does not parse');
  const declares = split.content.values.length + split.content.queries.length + split.content.imports.length > 0;
  const glyphs = glyphsForNodes(split.body);
  const data: StoryIslandData = {
    nodes: split.body, refData: opts.refData ?? {}, colorMode: opts.colorMode ?? 'light', template: opts.template ?? null, chrome: true,
    assetsUrl: '/a/DocAbc/assets', queryUrl: '/a/DocAbc/query',
    ...(Object.keys(glyphs).length ? { glyphs } : {}),
    ...(declares ? { dataflow: { flow: await compiledSource(source, opts.sources) } } : {}),
    ...(opts.viewer ? { viewer: opts.viewer } : {}),
    ...(opts.readOnly ? { readOnly: opts.readOnly } : {}),
  };
  const base: StoryBaseCssRecipe = { chrome: true, theme: opts.theme ?? null, faces: [], fonts: { slots: {}, families: [] } };
  const raw = { compiledCss: '.x{color:red}', authorCss: split.content.style ?? null };
  const parts = { baseCss: storyBaseCss(base), ...raw };
  return {
    data, css: inlineStoryCss(parts), overrides: styleOverrides(data.nodes, inlineStoryNodes(data.nodes, parts)), base,
    authorScript: null, theme: opts.theme ?? null, title: 'served', raw,
  };
}

// Queries stay in flight: the served "loading" state is what the survival check compares against.
const liveTransport = () => ({
  run: vi.fn(() => new Promise<never>(() => {})), page: vi.fn(() => new Promise<never>(() => {})),
  importAsset: vi.fn(async () => ({ refused: 'not in this test' })), dispose: vi.fn(),
});

const REFERENCES = ['aria-controls', 'aria-labelledby', 'aria-describedby', 'for'] as const;
/** Every id reference in `root` that names no element in the document. */
const dangling = (root: Element): string[] => [...root.querySelectorAll(REFERENCES.map((a) => `[${a}]`).join(','))]
  .flatMap((el) => REFERENCES.flatMap((a) => (el.getAttribute(a) ?? '').split(' ').filter(Boolean).filter((id) => !document.getElementById(id)).map((id) => `${a}=${id}`)));

/** Serve `runtime` as the app page does, mount the reader's runtime over it, and let it hydrate. */
async function adopt(runtime: Served) {
  document.body.innerHTML = `<div id="root"></div><div data-mx-initial-story=""><style>body > #root:first-child{display:none!important}</style>${servedStoryHtml(runtime, renderInlineStory)}</div>`;
  const story = document.querySelector<HTMLElement>('[data-mx-inline-story]')!;
  const serverNodes = [...story.querySelectorAll('*')];
  const serverDangling = dangling(story);
  captureInitialStory();
  const errors: unknown[] = [];
  vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args); });
  const reported = (event: ErrorEvent) => { errors.push(event.error ?? event.message); };
  window.addEventListener('error', reported);
  const app = createRoot(document.getElementById('root')!, { onRecoverableError: (e) => errors.push(e), onCaughtError: (e) => errors.push(e), onUncaughtError: (e) => errors.push(e) });
  let controller: InlineStoryController | null = null;
  await act(async () => {
    app.render(<InlineStoryRuntime data={runtime.data} prepared={runtime} rawSheets={async () => runtime.raw} transportFactory={liveTransport} authorScript={null} onController={(c) => { controller = c; }} hydrateInitialStory />);
  });
  await act(async () => {});
  return { story, serverNodes, serverDangling, errors, app, css: runtime.css, controller: () => controller!, stop: () => window.removeEventListener('error', reported) };
}

function expectAdopted({ story, serverNodes, serverDangling, errors }: Awaited<ReturnType<typeof adopt>>) {
  expect(errors).toEqual([]);
  // The server's element is the story now, inside the app's root, and every element it drew survived.
  expect(document.querySelector('[data-mx-initial-story]')).toBeNull();
  expect(document.getElementById('root')!.contains(story)).toBe(true);
  // Judged after the effects that follow hydration have run, so two parts replaced ON PURPOSE after
  // it are excused: a client-only pane's fallback (the chart placeholder), and a Radix popover
  // trigger, which re-wraps itself once its custom anchor registers (the same on /raw). The browser
  // gate judges at the hydration commit itself (scripts/gate-hydration.mjs) and excuses nothing.
  const lost = serverNodes.filter((n) => !story.contains(n) && !n.closest('[aria-label="Chart placeholder"],[data-slot="popover-trigger"]'));
  expect(lost.map((n) => n.outerHTML.slice(0, 120))).toEqual([]);
  // Generated ids agree: no reference names an element that is missing now and was not already
  // missing in the served markup (an author's own id on a Radix part is the only way to get one).
  expect(dangling(story).filter((ref) => !serverDangling.includes(ref))).toEqual([]);
}

const DIALOG = '<Dialog><DialogTrigger id="trigger"><Button id="add">Add task</Button></DialogTrigger><DialogContent aria-label="Add a task"><DialogClose>Cancel</DialogClose></DialogContent></Dialog>';
const POPOVER = `<div className="flex items-start gap-8">
  <TooltipProvider><Tooltip defaultOpen><TooltipTrigger className="underline">Hover target</TooltipTrigger><TooltipContent>Pinned open</TooltipContent></Tooltip></TooltipProvider>
  <Popover><PopoverAnchor /><PopoverTrigger className="underline">Popover trigger</PopoverTrigger><PopoverContent><PopoverHeader><PopoverTitle>Title</PopoverTitle></PopoverHeader></PopoverContent></Popover>
</div>`;
const DATA = `<Helmet>
  <Value name="rows" type="table" value={[{"k":"a","n":4},{"k":"b","n":7}]} />
  <Value name="pick" type="string" default="a" />
</Helmet>
<article><h1>Data</h1>
  <Select label="Pick" value="$pick" options={["a","b"]} />
  <p>Total <Number data="$rows" col="n" agg="sum" /></p>
  <DataTable data="$rows" height="200px" />
  <img src="ref:ImgRf1" alt="stored picture" />
  <Question title="Bars" data="$rows" height="200px" viz={{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"k","type":"nominal"},"y":{"field":"n","type":"quantitative"}}}}} />
</article>`;
const IMAGE_REF = { ImgRf1: { kind: 'image' as const, url: '/a/ImgRf1/raw?v=1', width: 640, height: 480 } };

describe('the reader adopts the page the server served', () => {
  afterEach(() => { clearInitialStory(); });

  const cases: Array<[string, () => Promise<Served>]> = [
    ['the kit fixture, light', () => served(fixture('kit.jsx'))],
    ['the kit fixture, dark, themed', () => served(fixture('kit.jsx'), { colorMode: 'dark', theme: 'modernist' })],
    ['a sectioned prose report with its outline rail', () => served(fixture('prose.jsx'), { template: 'editorial' })],
    ['the deck fixture', () => served(fixture('deck.jsx'), { template: 'deck' })],
    ['the Mermaid fixture', () => served(fixture('mermaid.jsx'))],
    ['the dashboard fixture, anonymous', () => served(fixture('dashboard.jsx').replaceAll('{{sales}}', SALES), { template: 'dashboard', sources: { [SALES]: [...SALES_COLUMNS] } })],
    ['the dashboard fixture, signed in, an archived version', () => served(fixture('dashboard.jsx').replaceAll('{{sales}}', SALES), { template: 'dashboard', sources: { [SALES]: [...SALES_COLUMNS] }, viewer: { id: 'user-1', name: 'Reader' } as StoryIslandData['viewer'], readOnly: 'This is version 2 of 3.' })],
    ['bound values, a table, a number, a chart and a stored image', () => served(DATA, { refData: IMAGE_REF })],
    ['a dialog trigger holding the author\'s Button', () => served(`<article>${DIALOG}</article>`)],
    ['icons, a tooltip and a popover', () => served(`<article><p><Icon name="circle-check" /> done <Icon name="ChartBar" /></p>${POPOVER}</article>`)],
    ['author CSS that tries to close its <style>', () => served('<Helmet><style>{`.a::after{content:"</style><STYLE>"}`}</style></Helmet><article><p className="a">styled</p></article>')],
  ];
  for (const [name, runtime] of cases) {
    it(`hydrates ${name} with no error or warning and keeps every server node`, async () => {
      const page = await adopt(await runtime());
      expectAdopted(page);
      await act(async () => { page.app.unmount(); });
      await act(async () => {});
      expect(page.errors).toEqual([]);
      page.stop();
    });
  }

  it('renders later versions, reader modes and themes through the adopted root, and unmounts it', async () => {
    const page = await adopt(await served(fixture('kit.jsx')));
    expectAdopted(page);
    const heading = page.story.querySelector('h1')!;
    await act(async () => { page.controller().update({ type: STORY_DOCUMENT_MESSAGE, nodes: parseJsxOrThrow('<article><h1>Second version</h1></article>').nodes, theme: 'modernist' }); });
    // A version the page was not served is isolated here, by the policy chunk loaded on demand.
    await vi.waitFor(() => expect(page.story.querySelector('h1')!.textContent).toBe('Second version'));
    expect(page.story.querySelector('style')!.textContent).toBe(page.css);
    expect(page.story.getAttribute('data-theme')).toBe('modernist');
    expect(heading.isConnected || page.story.querySelector('h1') !== heading).toBe(true);
    await act(async () => { page.controller().send({ type: STORY_READER_MODE_MESSAGE, mode: 'dark' }); });
    expect(page.story).toHaveClass('dark');
    await act(async () => { page.app.unmount(); });
    await act(async () => {});
    expect(page.story.childNodes.length).toBe(0);
    expect(page.errors).toEqual([]);
    page.stop();
  });

  it('applies a version sent the moment the controller arrives, with no error', async () => {
    const runtime = await served(fixture('kit.jsx'));
    document.body.innerHTML = `<div id="root"></div><div data-mx-initial-story="">${servedStoryHtml(runtime, renderInlineStory)}</div>`;
    captureInitialStory();
    const errors: unknown[] = [];
    // Outside act() on purpose, so React's act() environment warnings are not what this test is about.
    vi.spyOn(console, 'error').mockImplementation((...args) => { if (!String(args[0]).includes('not wrapped in act')) errors.push(args); });
    const app = createRoot(document.getElementById('root')!);
    let controller: InlineStoryController | null = null;
    // No act(): the app's first commit and the story's hydration run as the browser runs them.
    flushSync(() => app.render(<InlineStoryRuntime data={runtime.data} prepared={runtime} rawSheets={async () => runtime.raw} transportFactory={liveTransport} onController={(c) => { controller = c; }} hydrateInitialStory />));
    expect(controller).not.toBeNull();
    // Synchronously, as a discrete event would: React takes a render of a root still hydrating as a reason to discard the server tree.
    flushSync(() => controller!.update({ type: STORY_DOCUMENT_MESSAGE, nodes: parseJsxOrThrow('<article><h1>Early version</h1></article>').nodes }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(document.querySelector('[data-mx-inline-story] h1')!.textContent).toBe('Early version');
    expect(errors).toEqual([]);
    await act(async () => { app.unmount(); });
  });
});
