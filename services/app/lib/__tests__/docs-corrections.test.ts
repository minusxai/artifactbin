/**
 * The docs say what the code does — pinned by NAME, one assertion per error
 * the docs audit (~/projects/docs-improvement.md §1, §8, §9) reproduced live.
 *
 * Every line here was a wrong claim an agent acted on: `data="ref:<id>"` is
 * refused at the door but taught as a rule; `PATCH /api/my/...` under a bearer
 * token is a 401 but given as the fix; the deck skeleton's `<Question id={N}>`
 * fails publish; "silently fail" for a CDN script that is a hard 400. A doc
 * that teaches the retired thing is worse than none, because the agent has no
 * reason to doubt it.
 */
import { describe, it, expect } from 'vitest';
import { buildQuickSheet, renderDoc } from '../skills';
import { IMAGE_URL_FIELD_GUIDANCE } from '../agent-guidance';
import { OPERATIONS } from '../operations/registry';

const buildSkillDoc = (base: string) => ['artifactbin/references/publishing.md', 'artifactbin/references/publishing-annotations.md', 'artifactbin/references/publishing-datasets.md', 'artifactbin/references/publishing-versions.md'].map((p) => renderDoc(p, base)).join('\n');
const buildMarkupDoc = (base: string) => ['artifactbin/references/markup.md', 'artifactbin/references/markup-data.md', 'artifactbin/references/markup-video.md'].map((p) => renderDoc(p, base)).join('\n');
const buildDesignDoc = (base: string) => renderDoc('artifactbin/references/design.md', base);
const buildTemplateDoc = (base: string, name: string) => renderDoc(`artifactbin/references/templates-${name}.md`, base);
import { startBrief } from '../start-links';
import { publishJsx } from '../story/jsx-tier';

const BASE = 'https://example.test';

describe('the publishing skill', () => {
  const doc = buildSkillDoc(BASE);
  it('§1.4 does not send a bearer agent to /api/my (a browser-only surface, 401 for tokens)', () => {
    expect(doc).not.toMatch(/PATCH[^\n]*\/api\/my\//);
  });
  it('§1.5 the script sandbox names all four connect-src endpoints, not "no network" / "the one URL"', () => {
    expect(doc).not.toMatch(/the one URL its CSP admits/);
    expect(doc).not.toMatch(/no network\./);
    for (const p of ['/query', '/events', '/mutate', '/geojson/']) expect(doc).toContain(p);
  });
  it('§1.6 invalid_annotation_action lists reopen', () => {
    const row = doc.split('\n').find((l: string) => l.includes('invalid_annotation_action'))!;
    expect(row).toContain('reopen');
  });
  it('§1.6b the annotation markdown subset says what an image DOES — it is a link, not a picture', () => {
    // `![alt](url)` parses as a literal "!" plus a link (lib/markdown-lite has
    // no image node at all), so "images are shown as the characters you typed"
    // was a claim the parser does not honour.
    expect(doc).not.toMatch(/raw HTML, images and headings are\s*\n?shown as the characters/);
    expect(doc).toContain('is not an image');
    expect(doc).toContain('A comment cannot embed a picture.');
  });
  it('§1.7 the create response example shows edit_id and markup_changed, and does not promise markup', () => {
    const line = doc.split('\n').find((l: string) => l.includes('→ 201 {') && l.includes('"url"'))!;
    expect(line).toContain('"edit_id"');
    expect(line).toContain('"markup_changed"');
    expect(line).not.toContain('"markup": "<canonical');
  });
  it('§2.1 one bullet no longer says "read the full reference first" AND "guess rather than look up"', () => {
    expect(doc).not.toContain('for the full reference before authoring');
  });
  /*
   * ADDED (F3). `snippet` is the ANNOTATED NODE's text, recomputed on every
   * read; the words the person selected are `quote`, stored once and never
   * recomputed. The doc called the snippet "the text they selected", which sent
   * an agent looking for a sentence in a paragraph's worth of text.
   */
  it('§1.8 snippet is the node\'s text; the SELECTION is `quote`', () => {
    const snippet = doc.split('\n').find((l: string) => l.includes('"snippet"'))!;
    expect(snippet).not.toContain('the text they selected');
    expect(snippet).toContain('node');
    const quote = doc.split('\n').find((l: string) => l.includes('"quote"'))!;
    expect(quote).toContain('selected');
    expect(doc).toContain('quote_found');
  });
  it('§1.9 current comments use persistent IDs and legacy anchors are preservation-only', () => {
    const text = doc.replace(/\s+/g, ' ');
    expect(text).toContain("sidecar relations to the node's persistent BODY `id`");
    expect(text).toContain('preserve an existing value with its element');
    expect(text).toContain('never author, change or reuse one');
    expect(text).toContain('New comments do not add it');
  });
  /*
   * ADDED (F8). Forking became an AGENT verb, and the thing an agent needs is
   * not the address — the registry renders that — but WHEN to reach for it:
   * the create/edit loop is where a document that already exists gets adapted.
   */
  it('§F8 teaches forking as the way to adapt a document you can read', () => {
    expect(doc).toContain(`POST ${BASE}/api/artifacts/<id>/fork`);
    expect(doc.replace(/\s+/g, ' ')).toContain('To adapt a document you can read, fork it, then edit the copy');
    expect(doc).toContain('"forked_from"');
  });
  it('§1 error table carries image_fetch_failed and dataset_read_only', () => {
    expect(doc).toContain('image_fetch_failed');
    expect(doc).toContain('dataset_read_only');
  });
});

/*
 * ADDED (folders, P4). Three claims the folders work made load-bearing, each
 * one an agent acts on rather than reads past.
 *
 * `unlisted` promises the document is listed NOWHERE, and a folder's page IS a
 * listing — so a stranger holding the folder's link is handed its `public`
 * children and nothing else. Said only beside `/@username` it reads as "not on
 * your profile", which is now the smaller half of the promise.
 *
 * DELETE is no longer the end of a document. An agent that believes it is asks
 * its user to confirm the wrong thing, and one that has never heard of
 * `restore_artifact` cannot undo the mistake it has just made.
 *
 * And the two limits are STATED rather than fixed, which only helps if the
 * words survive the next edit that needs a few bytes back: a comment does not
 * go to the trash, and a restore can land a row below the depth cap.
 */
describe('folders and the trash', () => {
  const doc = buildSkillDoc(BASE);
  const flat = (t: string) => t.replace(/\s+/g, ' ');
  it('§P4.1 unlisted is listed nowhere — a folder page included', () => {
    expect(flat(doc)).toContain('unlisted is listed nowhere, a folder page included');
  });
  it('§P4.2 delete is a trash, and restore is named', () => {
    expect(doc).toContain('DELETE is a TRASH');
    expect(doc).toContain('restore_artifact');
    expect(flat(doc)).toContain('restorable with no deadline');
  });
  /*
   * THE THREE CONSEQUENCES OF HAVING NO PURGE. Each is a promise an agent may
   * repeat to its user, and each was previously the opposite: there is no
   * retention, deleting frees no quota, and the only real erasure is an
   * operator's, outside this API. A doc that stops saying one of them is a doc
   * that lets an agent promise something untrue.
   */
  it('§P5.2 a deleted COMMENT is not erased either — and an agent cannot undo one', () => {
    expect(flat(doc)).toContain('A deleted thread is not erased');
    expect(flat(doc)).toContain('there is no undo for it here');
  });
  it('§P5.1 nothing is ever erased, and the docs say so three ways', () => {
    expect(flat(doc)).toContain('Nothing here is ever erased');
    expect(flat(doc)).toContain('still counts against your quota');
    expect(flat(doc)).toContain('an administrative act on the database, outside this API');
    expect(flat(doc), 'no retention survives anywhere in the docs').not.toContain('30 days');
  });
  it('§P4.3 the two limits are stated, not implied away', () => {
    expect(flat(doc)).toContain('a restore can land a row deeper than the 6-level cap');
  });
  /*
   * ADDED (the folder page). A folder was a DOCUMENT — created with a two-line
   * scaffold as its stored source — and the docs said so: "A folder's page is
   * its own stored markup … so you edit one like any document." It carries no
   * content now, and its page is rendered by the app. That sentence is the
   * shape of wrong claim this file exists for: an agent does not read past it,
   * it acts on it, and the act is a `not_editable` on a document it was told
   * it could edit. So the replacement is pinned by NAME, both halves — what a
   * folder has (nothing) and what its PUT will take.
   */
  it('§FP.1 a folder has NO content, and the page is not something you edit', () => {
    expect(flat(doc)).toContain('A FOLDER HAS NO CONTENT');
    expect(flat(doc)).toContain('are all a PUT takes on one');
    expect(flat(doc), 'the scaffold is gone').not.toContain('its own stored markup');
    expect(flat(doc), 'a folder is not edited like a document').not.toContain('edit one like any document');
  });
});

describe('the markup skill', () => {
  const doc = buildMarkupDoc(BASE);
  it('§1.2 markdown is refused, never "auto-converted"', () => {
    expect(doc).not.toContain('auto-converted');
  });
  it('§1.3 a <Video poster> web URL is imported, not rejected', () => {
    expect(doc).not.toContain('thumbnail URLs are rejected');
  });
  it('§1.8 <Number> documents suffix and that agg defaults to first', () => {
    expect(doc).toMatch(/suffix/);
    expect(doc).toMatch(/agg[^\n]*(defaults? to|default[^\n]*)`first`/);
  });
  it('§1 omissions: all 8 shipped recipes are named', () => {
    for (const r of ['trend', 'funnel', 'waterfall', 'radar', 'combo', 'single-value', 'choropleth', 'point-map']) {
      expect(doc, `minusx/${r}@1`).toContain(`minusx/${r}@1`);
    }
  });
  it('§1 props are not validated — the allowlist section says so', () => {
    expect(doc).toMatch(/props are not validated|unknown props? (are|is) (ignored|not validated)/i);
  });
  it('§1.5 the CSP paragraph names the four endpoints', () => {
    expect(doc).not.toContain('the one URL its CSP admits');
  });
  /*
   * ADDED (F8 round 2). The JSX MICRO-RULES — a tag closes, a comment is
   * `{/* … *\/}`, and there is no document shell — were carried by
   * publishing.md's orientation bullet and were DELETED with it rather than
   * folded into their owner. They are the two mistakes an HTML-habit model
   * makes on its first write (`<br>`, `<!-- -->`), and the only thing left to
   * catch them was a 400 round trip. They live in markup.md, which owns the
   * vocabulary.
   */
  it('§F8 the JSX micro-rules are documented: closing tags, JSX comments, no document shell', () => {
    expect(doc).toContain('every tag closes (`<br />`)');
    expect(doc).toContain('{/* … */}');
    expect(doc).toContain('`<html>`');
  });
});

/*
 * ADDED (the external-assets batch, milestone 5). A web URL in an image
 * position is no longer REWRITTEN to `ref:<id>` — publish stores a copy and
 * the author's URL stays in the source, byte for byte, because an agent reads
 * back what it wrote. Three files promised the rewrite in three wordings
 * (markup.md, markup-video.md, publishing-datasets.md) and the MCP schema
 * promised it in a fourth; a doc that teaches a retired mechanic is worse than
 * none, and this one an agent would act on by hunting for an id that is never
 * echoed.
 */
describe('URL-kept external assets', () => {
  const markup = buildMarkupDoc(BASE);
  const publishing = buildSkillDoc(BASE);
  const flat = (t: string) => t.replace(/\s+/g, ' ');

  it('no markup file still promises the `ref:` rewrite', () => {
    // Flattened: both wordings broke across a line, and "the registry echoed
    // back" for an unknown component name is a different, still-true sentence.
    expect(flat(markup)).not.toMatch(/echoed back (as|rewritten to) `ref:/);
    expect(flat(markup)).not.toMatch(/rewritten to `ref:/);
  });
  it('the markup vocabulary says the copy is stored and the URL is kept', () => {
    expect(flat(markup)).toContain('publish stores a copy, YOUR URL STAYS as written');
  });
  it('…and that a URL that will not fetch is a warning, not a failed publish', () => {
    expect(flat(markup)).toContain('a URL that will not fetch is a warning, not a failed publish');
  });
  it('the subresource roster names all three positions and the `$` binding', () => {
    expect(flat(markup)).toContain('Only `<img src>`, `<Video poster>` and `<File src>` take a URL');
    expect(flat(markup)).toContain('An image `src` also binds');
    expect(markup).toContain('{$pick}');
  });
  it('the CSS strip carves out the one url() publish now imports', () => {
    expect(markup).not.toMatch(/external\s*\n?\s*`url\(\)`\/`@import` are stripped/);
    expect(flat(markup)).toContain('`@import` and a `url()` outside `@font-face` are stripped');
  });
  it('the web-fonts bullet says an @font-face url is imported too', () => {
    expect(flat(markup)).toContain('An `@font-face` `url(https://…)` in your `<style>` is imported the same way');
  });
  it('a <Video poster> URL is stored and kept, never rewritten', () => {
    expect(flat(markup)).toContain('which publish fetches and stores — your URL stays in the document as written');
  });
  it('a DataTable column of image URLs is declared, and served from our copy', () => {
    expect(flat(markup)).toContain('kind: "image"');
    expect(flat(markup)).toMatch(/fetched on first view/);
  });
  it('an imported URL is not an artifact and is not in the listing', () => {
    expect(flat(publishing)).toContain('An imported URL is NOT an artifact');
    expect(flat(publishing)).toContain('never appears in `GET ' + BASE + '/api/artifacts`');
  });
  it('the byte quota is the account\'s, and the first importer pays once', () => {
    expect(flat(publishing)).toContain('count against your ACCOUNT\'s byte quota');
    expect(flat(publishing)).toContain('charged once, to whoever first named the URL');
  });
  it('the MCP image-url field no longer promises the rewrite either', () => {
    expect(IMAGE_URL_FIELD_GUIDANCE).not.toContain('rewritten to ref:<id>');
    expect(IMAGE_URL_FIELD_GUIDANCE).toContain('LEAVES YOUR URL in the document');
  });
  it('create_artifact says a web URL needs no upload', () => {
    const create = OPERATIONS.find((o) => o.name === 'create_artifact')!;
    expect(create.description).toContain('<img src="https://…">');
  });
  it('refresh_asset names every kind it actually refreshes — PDFs included', () => {
    const refresh = OPERATIONS.find((o) => o.name === 'refresh_asset')!;
    expect(refresh.description).toContain('image, font or PDF');
  });
});

/*
 * ADDED (milestone 5). An agent answering a comment reads
 * publishing-annotations.md and nothing else — measured in the eval spike,
 * where every MCP reply signed itself "Agent". The auth reference owns the
 * header; the file an agent is actually in has to NAME it.
 */
describe('a REST reply is signed', () => {
  it('the annotations reference teaches Artifactbin-Agent on the reply call', () => {
    const doc = renderDoc('artifactbin/references/publishing-annotations.md', BASE);
    expect(doc).toContain('Artifactbin-Agent');
    expect(doc.replace(/\s+/g, ' ')).toContain('signed with your name instead of "Agent"');
  });
});

describe('the design skill', () => {
  const doc = buildDesignDoc(BASE);
  it('§1.1 numbers bind through <Query> → data="$name", never a `ref:` dataset', () => {
    expect(doc).not.toContain('binds to a real `ref:` dataset');
    expect(doc).toContain('<Query');
  });
  it('§2.4 / §8.4 the web-font route is the Helmet meta, not a data: URI', () => {
    expect(doc).toContain('name="font-display"');
  });
  it('§8.3 color mode is the root class, not prefers-color-scheme', () => {
    expect(doc).not.toContain('prefers-color-scheme');
  });
});

describe('template pages', () => {
  it('§8.1 every skeleton PUBLISHES — run through the validator the door uses', async () => {
    for (const name of ['deck', 'editorial', 'dashboard', 'scrolly']) {
      const doc = buildTemplateDoc(BASE, name)!;
      const lines = doc.split('\n');
      const start = lines.findIndex((l) => /^\s{2,}</.test(l));
      expect(start, `${name}: skeleton present`).toBeGreaterThan(-1);
      let end = start;
      while (end < lines.length && (lines[end].trim() === '' || /^\s{2,}\S/.test(lines[end]))) end++;
      const skeleton = lines.slice(start, end).join('\n');
      const result = await publishJsx({}, skeleton);
      const refused = result instanceof Response ? (await result.text()).slice(0, 300) : null;
      expect(refused, `${name} skeleton refused: ${refused}`).toBeNull();
    }
  });
  it('§8.2 editorial no longer says remote image URLs are rejected', () => {
    // Whitespace-collapsed: the YAML wraps prose, and the first version of this
    // assertion passed against the WRONG page because the phrase broke across a line.
    expect(buildTemplateDoc(BASE, 'editorial')!.replace(/\s+/g, ' ')).not.toContain('remote URLs are rejected');
  });
});

describe('the start brief and quick sheet', () => {
  const sheet = buildQuickSheet(BASE);
  it('§9.a says a dangerous tag (form/iframe/meta…) is refused WITHOUT the allowlist', () => {
    expect(sheet).toMatch(/<form>|form,? iframe|iframe, ?meta|form\/iframe/i);
  });
  it('§9.b a CDN script or external stylesheet is a 400, not a silent failure', () => {
    expect(sheet).not.toMatch(/silently fail/);
  });
  it('§9.3 the brief and the sheet agree on the second write: /edits, not a whole-document PUT', () => {
    const brief = startBrief(BASE, 'ABC123', 'secret');
    expect(brief).not.toContain('simply replace');
  });
});

/**
 * F2 — the docs teach the reader's link, because it is the whole point of the
 * feature: an agent that knows `?$name=value` can hand its user a document
 * already narrowed to what they asked about, instead of one they must narrow
 * themselves.
 */
describe('the markup skill teaches the $ link', () => {
  const doc = buildMarkupDoc(BASE);
  it('names the URL form, the empty value, and that a reader\'s own picks travel', () => {
    expect(doc).toMatch(/\?\$region=/);
    expect(doc).toMatch(/pre-filtered link/);
  });
});
