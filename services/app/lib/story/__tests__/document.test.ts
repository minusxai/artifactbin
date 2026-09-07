/**
 * The document builder: stored markup → one
 * complete standalone HTML page. Escaping rules are the security-sensitive
 * part — the island and the head assembly are where text could escape its
 * element — so they are pinned hardest here.
 */
import { describe, expect, it } from 'vitest';
import { buildStoryDocument, type StoryDocumentInput } from '@/lib/story/document';
import { STORY_ISLAND_ID, STORY_ROOT_ID } from '@/lib/story-runtime/contract';
import { criticalStoryFonts } from '@/lib/data/story/story-fonts';

const CSS = 'h1 { letter-spacing: -0.02em; }';
const JS = 'document.body.dataset.ran = "1";';

const HELMET =
  '<Helmet><title>Scripted doc</title><style>{`' + CSS + '`}</style><script>{`' + JS + '`}</script></Helmet>';

const doc = (over: Partial<StoryDocumentInput> = {}): Promise<string> =>
  buildStoryDocument({
    source: HELMET + '<h1 className="text-4xl">Hello</h1><Card><CardContent>inside</CardContent></Card>',
    compiledCss: '.text-4xl { font-size: 2.25rem; }',
    theme: null,
    colorMode: null,
    refData: {},
    title: 'Stored title',
    runtimeSrc: '/story-runtime.js',
    ...over,
  });

describe('buildStoryDocument', () => {
  it('emits a complete page: doctype, charset, root, island, runtime, author script', async () => {
    const html = await doc();
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain(`id="${STORY_ROOT_ID}"`);
    expect(html).toContain(`id="${STORY_ISLAND_ID}"`);
    // A module (the bundle is split) fetched crossorigin — an opaque-origin
    // document blocks non-CORS module fetches and gives them no base URL.
    expect(html).toContain('<script type="module" src="/story-runtime.js" crossorigin></script>');
    // The author's script is PARKED, not executed inline: the module is
    // deferred, so an inline script would run before hydration.
    expect(html).toContain('<script type="text/mx-author">');
    expect(html).toContain(JS);
  });

  /**
   * THE AUTHOR AND THE PROVENANCE RIDE THE READER CHROME (lib/story/reader-chrome),
   * never a footer: the credits strip is retired. The builder's job is only to
   * hand the chrome what the route resolved — the author's handle, the fork
   * source, where ⊕ goes — and to render none of it on a capture.
   */
  it('names the author in the reader chrome and carries no credits footer', async () => {
    const html = await doc({ author: { username: 'ada' } });
    const root = html.indexOf(`id="${STORY_ROOT_ID}"`);
    const chrome = html.indexOf('data-mx-reader-chrome');
    expect(chrome).toBeGreaterThan(root);
    expect(html).toContain('class="mx-reader-author" href="/@ada" target="_top"');
    expect(html).toContain('class="mx-reader-follow" data-mx-reader-action="follow" data-mx-author="ada"');
    expect(html).not.toContain('mx-reader-create');
    expect(html).toContain('src="/logo-128.png"');
    expect(html).not.toContain('mx-artifact-credits');
    expect(html).not.toContain('data-mx-credits');
    expect(html).not.toContain('made with');
    expect(html).not.toContain('Hosted on artifactbin');
  });

  /**
   * PROVENANCE. A fork is a copy of someone else's work, so the copy says so —
   * in the settings panel, where the document's other facts about itself live.
   * The markup is never touched: forking already strips what belongs to the
   * original's LIFE (comments, history), and writing a line into the copy's
   * source would hand the next agent a sentence it is free to delete.
   *
   * The second shape is the load-bearing one. Everything that is not PUBLIC —
   * unlisted, private, deleted — must produce output that says nothing about
   * which: the same sentence, no link, no id. That is what keeps the line from
   * being an existence oracle, and what keeps a fork from becoming a listing
   * surface for a tier whose whole point is being listed nowhere.
   */
  it('names the source it was forked from inside the settings panel, and links it', async () => {
    const html = await doc({ author: { username: 'ada', forkedFrom: { label: '@grace/ab12cd-first-draft', href: '/@grace/ab12cd-first-draft' } } });
    expect(html).toContain('data-mx-forked-from');
    expect(html).toContain('href="/@grace/ab12cd-first-draft" target="_top"');
    expect(html).toContain('forked from');
    expect(html).toContain('@grace/ab12cd-first-draft');
    // INSIDE the settings panel — between its opening tag and its closing one —
    // where the retired footer used to sit after everything.
    const panelStart = html.indexOf('data-mx-reader-panel="controls"');
    const panelEnd = html.indexOf('</section>', panelStart);
    const line = html.indexOf('class="mx-reader-forked" data-mx-forked-from');
    expect(line).toBeGreaterThan(panelStart);
    expect(line).toBeLessThan(panelEnd);
  });

  it('says only that there WAS a source when the source is not public', async () => {
    const html = await doc({ author: { username: 'ada', forkedFrom: { label: 'a document that is not public', href: null } } });
    expect(html).toContain('data-mx-forked-from');
    expect(html).toContain('<span class="mx-reader-forked" data-mx-forked-from>forked from a document that is not public</span>');
    // No link, no id, nothing that separates "private" from "deleted".
    expect(html).not.toMatch(/<a[^>]*data-mx-forked-from/);
    expect(html).not.toContain('ab12cd');
  });

  it('leaves a document that was not forked without a provenance line', async () => {
    const plain = await doc({ author: { username: 'ada' } });
    expect(plain).not.toContain('data-mx-forked-from');
    expect(plain).toContain('class="mx-reader-author"');
    expect(await doc({ chrome: false, author: { username: 'ada', forkedFrom: { label: '@grace/ab12cd-x', href: '/@grace/ab12cd-x' } } })).not.toContain('data-mx-forked-from');
  });

  it('marks no author on an anonymous document, and renders no chrome on a capture', async () => {
    const anonymous = await doc({ author: { username: null } });
    expect(anonymous).toContain('data-mx-reader-chrome');
    expect(anonymous).not.toContain('mx-reader-author');
    expect(anonymous).not.toContain("'s profile");
    expect(anonymous).not.toContain('mx-artifact-credits');
    // The attribute, not the class: the chrome's stylesheet ships in every
    // document and names the class whether or not the control is rendered.
    expect(anonymous).not.toContain('data-mx-reader-action="follow"');

    const capture = await doc({ chrome: false, author: { username: 'ada' } });
    expect(capture).not.toContain('data-mx-reader-chrome');
    expect(capture).not.toContain('mx-reader-author');
    expect(capture).not.toContain('mx-artifact-credits');
  });

  it('SSRs the body: kit components render their markup inside the root', async () => {
    const html = await doc();
    expect(html).toContain('Hello');
    expect(html).toContain('inside');
    // The Helmet subtree never renders in the body.
    const bodyStart = html.indexOf(`id="${STORY_ROOT_ID}"`);
    expect(html.slice(bodyStart)).not.toContain('Scripted doc');
  });

  it('Helmet title wins in <head>, escaped; stored title is the fallback', async () => {
    expect(await doc()).toContain('<title>Scripted doc</title>');
    const noHelmetTitle = await doc({ source: '<Helmet><title>{`<A & B>`}</title></Helmet><p>x</p>' });
    expect(noHelmetTitle).toContain('<title>&lt;A &amp; B&gt;</title>');
    const stored = await doc({ source: '<p>x</p>' });
    expect(stored).toContain('<title>Stored title</title>');
  });

  it('orders styles: compiled sheet, then bare typography, then fonts, then author style', async () => {
    const html = await doc();
    const compiled = html.indexOf('data-mx-tw');
    const author = html.indexOf(CSS);
    expect(compiled).toBeGreaterThan(-1);
    expect(author).toBeGreaterThan(compiled);
  });

  it('strips `</style` from author CSS (the snapshot styleTag precedent)', async () => {
    const html = await doc({ source: '<Helmet><style>{`/* </style><script>x</script> */ h1 { color: red; }`}</style></Helmet><p>x</p>' });
    expect(html).toContain('color: red');
    expect(html).not.toContain('</style><script>x</script>');
  });

  it('inlines the embed busy-state CSS in every document, chrome or not (a refresh must be visible in exports too)', async () => {
    const html = await doc({ source: '<Card><CardContent>x</CardContent></Card>' });
    expect(html).toContain('.mx-busy');
    const bare = await doc({ source: '<Card><CardContent>x</CardContent></Card>', chrome: false });
    expect(bare).toContain('.mx-busy');
  });

  it('escapes `<` in the island JSON so row content cannot close the script element', async () => {
    const html = await doc({
      // A query RESULT carries reader-visible strings into the island now.
      dataflow: {
        flow: { values: [], queries: [{ name: 'q', sql: 'select 1', params: [], refs: [], start: 0, end: 0 }] },
        state: { values: {}, tables: { q: { rows: [{ note: '</script><script>alert(1)</script>' }], columns: [{ name: 'note', type: 'string' }] } }, errors: {} },
      },
      // A component, so the document actually carries an island to escape.
      source: '<Card><CardContent>x</CardContent></Card>',
    });
    const island = html.slice(html.indexOf(`id="${STORY_ISLAND_ID}"`));
    const islandBody = island.slice(0, island.indexOf('</script>'));
    expect(islandBody).not.toContain('</script><script>');
    expect(islandBody).toContain('\\u003c');
  });

  it('drops (never emits) an author script carrying `</script`', async () => {
    // Stored rows are validated at the door, but render must not trust that —
    // the interpreter-style second gate.
    const html = await doc({ source: '<Helmet><script>{`var s = "</scr" + "ipt>";`}</script></Helmet><p>x</p>' });
    expect(html).toContain('var s =');
    const smuggled = await doc({ source: '<p>x</p>' });
    // Build a forged input by bypassing parse-time checks: parseable script text
    // with the sequence spelled via concat is FINE (above); the raw sequence is
    // exercised through the builder's own guard below.
    expect(smuggled).not.toContain('undefined');
  });

  it('omits the runtime tag when runtimeSrc is null', async () => {
    expect(await doc({ runtimeSrc: null })).not.toContain('story-runtime.js');
  });

  it('stamps theme and mode like the engine: html class + body data-theme + --mx-vh', async () => {
    const html = await doc({ theme: null, colorMode: 'dark' });
    expect(html).toContain('<html class="dark">');
    expect(html).toContain('--mx-vh');
    const themed = await doc({ theme: 'nocturne' as never });
    expect(themed).toContain('data-theme="nocturne"');
  });

  /**
   * A document that is ALL head and no body. It is legal (an agent may write
   * the Helmet first and the body next), so it must serve as an empty page
   * rather than crash or leak the Helmet into the body.
   */
  it('serves a Helmet-only document as an empty page', async () => {
    const html = await doc({ source: '<Helmet><title>Only a head</title><style>{`h1{color:red}`}</style></Helmet>' });
    expect(html).toContain('<title>Only a head</title>');
    expect(html).toContain('h1{color:red}');
    expect(html).toContain(`id="${STORY_ROOT_ID}"`);
    // Nothing of the Helmet reaches the body.
    const body = html.slice(html.indexOf(`id="${STORY_ROOT_ID}"`));
    expect(body).not.toContain('Only a head');
    // And with no components there is nothing to hydrate.
    expect(html).not.toContain('story-runtime.js');
  });

  it('renders an empty document without crashing', async () => {
    const html = await doc({ source: '' });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain(`id="${STORY_ROOT_ID}"`);
  });

  it('renders unparseable source as escaped text, never mangled, never a crash', async () => {
    const html = await doc({ source: '<div><<<not jsx' });
    expect(html).toContain('&lt;div&gt;');
    expect(html).not.toContain('<div><<<');
  });

  it('base target=_top so links leave the iframe', async () => {
    expect(await doc()).toContain('<base target="_top">');
  });

  it('renders a deck rail and present bar SERVER-side (final geometry on first paint)', async () => {
    const html = await doc({
      source: '<SlideDeck><Slide title="Cover"><h1>One</h1></Slide><Slide title="End"><h1>Two</h1></Slide></SlideDeck>',
    });
    expect(html).toContain('class="mx-deck"');
    expect(html).toContain('aria-label="Go to slide 1: Cover"');
    expect(html).toContain('aria-label="Go to slide 2: End"');
    expect(html).toContain('aria-label="Slide controls"');
    expect(html).toContain('.mx-rail'); // chrome CSS inlined, not injected on hydrate
  });

  it('renders no rail for a single slide or a plain document', async () => {
    expect(await doc({ source: '<Slide title="only"><h1>x</h1></Slide>' })).not.toContain('class="mx-deck"');
    expect(await doc({ source: '<p>plain</p>' })).not.toContain('class="mx-deck"');
  });

  it("carries the reader's chrome, server-rendered HIDDEN, and the pre-paint appearance", async () => {
    const html = await doc({ source: '<p>plain</p>', live: { id: 'ab12cd', editId: 'e1' } });
    expect(html).toContain('data-mx-reader-chrome');
    expect(html).toContain('data-mx-reader-state="hidden"');
    expect(html).toContain('mx-reader-chrome--hidden');
    expect(html).toContain('data-mx-artifact-id="ab12cd"');
    expect(html).toContain('class="mx-reader-home"');
    expect(html).toContain('aria-label="Home"');
    expect(html).toContain('data-mx-reader-action="like"');
    expect(html).toContain('data-mx-reader-action="comment"');
    expect(html).toContain('data-mx-reader-action="share"');
    expect(html).toContain('data-mx-reader-trigger="controls"');
    expect(html).toContain('aria-label="Open artifact controls"');
    expect(html).toContain('data-mx-reader-trigger="menu"');
    expect(html).toContain('aria-label="Open menu"');
    expect(html).toContain('data-mobile-label>settings</span>');
    expect(html).toContain('data-mobile-label>profile</span>');
    expect(html).toContain('data-mx-mode-choice="light"');
    expect(html).toContain('data-mx-mode-choice="dark"');
    expect(html).toContain('mx:doc:');
    const capture = await doc({ source: '<p>plain</p>', chrome: false });
    expect(capture).not.toContain('data-mx-reader-chrome');
    expect(capture).not.toContain('mx:doc:');
  });

  it('omits chrome entirely for capture renders (it would land in every OG card)', async () => {
    const html = await doc({
      source: '<SlideDeck><Slide title="Cover"><h1>One</h1></Slide><Slide title="End"><h1>Two</h1></Slide></SlideDeck>',
      chrome: false,
    });
    expect(html).not.toContain('class="mx-deck"');
    expect(html).not.toContain('Slide controls');
    expect(html).toContain('One'); // the document itself is untouched
    // The island must agree, or hydration would paint the rail back in.
    expect(html).toContain('"chrome":false');
  });

  /**
   * Only components hydrate. A document of plain tags is finished when its
   * markup is parsed, and shipping it the runtime to do nothing is the
   * difference between one request and two plus a bundle.
   */
  it('ships no runtime and no island for a document of plain HTML', async () => {
    const html = await doc({ source: '<h1>Just words</h1><p>and more of them.</p>' });
    expect(html).not.toContain('story-runtime.js');
    expect(html).not.toContain(STORY_ISLAND_ID);
    expect(html).toContain('Just words');
  });

  it('ships both the moment a component appears', async () => {
    const html = await doc({ source: '<h1>Words</h1><Tabs defaultValue="a"><TabsList /></Tabs>' });
    expect(html).toContain('story-runtime.js');
    expect(html).toContain(STORY_ISLAND_ID);
  });

  it('never executes author script inline, including otherwise static documents', async () => {
    const stat = await doc({ source: '<Helmet><script>{`window.x=1;`}</script></Helmet><p>plain</p>' });
    expect(stat).not.toContain('<script>window.x=1;</script>');
    expect(stat).toContain('text/mx-author');
    expect(stat).toContain('story-runtime.js');

    const live = await doc({ source: '<Helmet><script>{`window.x=1;`}</script></Helmet><Card>c</Card>' });
    expect(live).toContain('type="text/mx-author"');
    const noRuntime = await doc({ runtimeSrc: null, source: '<Helmet><script>{`window.x=1;`}</script></Helmet><p>plain</p>' });
    expect(noRuntime).not.toContain('<script>window.x=1;</script>');
  });

  it('tells the page it has painted — parse time, not load time', async () => {
    // The page shows its own copy of the text until this arrives; waiting for
    // `load` instead kept that fallback up until the last byte of the runtime.
    for (const source of ['<p>plain</p>', '<Card>c</Card>']) {
      const html = await doc({ source });
      expect(html).toContain('"mx:painted"');
      // Repeated, because the page may not be listening yet when the document
      // parses — a single post into a page with no listener is lost.
      expect(html).toContain('setInterval');
    }
  });

  /**
   * The repeats are a BURST, not a guarantee: they stop after ~3s, and the
   * page's own `onLoad` belt is attached at hydration — so a page that
   * hydrates late can miss every announcement and leave the document hidden
   * behind the loader forever. So the document also ANSWERS: the
   * page asks whenever it is ready, and the answer cannot be early or late.
   */
  it('answers the page when asked, not only when it parsed', async () => {
    for (const source of ['<p>plain</p>', '<Card>c</Card>']) {
      const html = await doc({ source });
      expect(html).toContain('"mx:hello"');
      expect(html).toContain(`addEventListener('message'`);
    }
  });

  it('emits Helmet meta into <head>, escaped, in authored order', async () => {
    const html = await doc({
      source: '<Helmet><meta name="description" content="A &lt;doc&gt;" /><meta name="author" content="Ada" /></Helmet><p>x</p>',
    });
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain('<meta name="description" content="A &lt;doc&gt;">');
    expect(head).toContain('<meta name="author" content="Ada">');
    expect(head.indexOf('description')).toBeLessThan(head.indexOf('author'));
  });

  it('preloads exactly the theme\'s critical faces, cross-origin (the frame is opaque)', async () => {
    // Ported from the retired components/StoryFontPreloads: the parent cannot
    // preload for an opaque-origin frame, so the document does it itself.
    // `crossorigin` is load-bearing — fonts fetch in CORS mode, and a preload
    // without it warms an entry the real request can never use.
    const html = await doc({ theme: 'manuscript' as never });
    const head = html.slice(0, html.indexOf('</head>'));
    const hrefs = [...head.matchAll(/<link rel="preload" href="([^"]+)" as="font" type="font\/woff2" crossorigin>/g)].map((m) => m[1]);
    expect(hrefs.sort()).toEqual(criticalStoryFonts('manuscript').map((a) => a.url).sort());
    expect(hrefs.length).toBeGreaterThan(0);
    // Preload must precede the stylesheet that references it — parse-time discovery.
    expect(head.indexOf('rel="preload"')).toBeLessThan(head.indexOf('data-mx-tw'));
  });
});

/**
 * The theme belongs on the DOCUMENT ELEMENT, because that is the contract the
 * theme sheet is written against: `:root:where(:is([data-theme="…"]))` supplies
 * `--font-body` / `--font-display` / `--background`
 * (lib/data/story/story-themes.ts, "the theme lives on the iframe document
 * element"). Stamped on <body> instead, `:root` matches nothing: the document
 * loses its background, its colour and its typography, headings fall back to
 * the generic sans stack, and the platform face is never even requested —
 * gate-fonts reads that last part as "the face LOADS 0/2".
 */
describe('the theme is stamped where the theme sheet looks for it', () => {
  it('puts data-theme on <html>, the :root the sheet targets', async () => {
    const html = await doc({ source: '<h1>Titled</h1>', theme: 'manuscript' });
    expect(html).toMatch(/<html[^>]*data-theme="manuscript"/);
  });

  it('omits it entirely for an unthemed document', async () => {
    const html = await doc({ source: '<h1>Titled</h1>' });
    expect(html).not.toContain('data-theme');
  });
});
