/**
 * The docs say what the code does — pinned by NAME, one assertion per error
 * a docs audit reproduced live.
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
import { publishJsx } from '../story/jsx-tier';

const BASE = 'https://example.test';

describe('the publishing skill', () => {
  const doc = buildSkillDoc(BASE);
  it('does not send a bearer agent to /api/my (a browser-only surface, 401 for tokens)', () => {
    expect(doc).not.toMatch(/PATCH[^\n]*\/api\/my\//);
  });
  it('the script sandbox names all four connect-src endpoints, not "no network" / "the one URL"', () => {
    expect(doc).not.toMatch(/the one URL its CSP admits/);
    expect(doc).not.toMatch(/no network\./);
    for (const p of ['/query', '/events', '/mutate', '/geojson/']) expect(doc).toContain(p);
  });
  it('the comment command teaches reopening through --state open', () => {
    expect(doc).toContain('--state');
    expect(doc).toContain('open or resolved');
  });
  it('the annotation markdown subset says what an image DOES — it is a link, not a picture', () => {
    // `![alt](url)` parses as a literal "!" plus a link (lib/markdown-lite has
    // no image node at all), so "images are shown as the characters you typed"
    // was a claim the parser does not honour.
    expect(doc).not.toMatch(/raw HTML, images and headings are\s*\n?shown as the characters/);
    expect(doc).toContain('is not an image');
    expect(doc).toContain('A comment cannot embed a picture.');
  });
  it('push handles the canonical response and sync identity', () => {
    expect(doc).toContain('canonical source and identity in the same response');
    expect(doc).toContain('records the accepted server state privately in ~/.artifactbin/state.sqlite');
  });
  it('one bullet no longer says "read the full reference first" AND "guess rather than look up"', () => {
    expect(doc).not.toContain('for the full reference before authoring');
  });
  /*
   * `snippet` is the ANNOTATED NODE's text, recomputed on every
   * read; the words the person selected are `quote`, stored once and never
   * recomputed. The doc called the snippet "the text they selected", which sent
   * an agent looking for a sentence in a paragraph's worth of text.
   */
  it('snippet is the node\'s text; the SELECTION is `quote`', () => {
    const snippet = doc.split('\n').find((l: string) => l.includes('"snippet"'))!;
    expect(snippet).not.toContain('the text they selected');
    expect(snippet).toContain('node');
    const quote = doc.split('\n').find((l: string) => l.includes('"quote"'))!;
    expect(quote).toContain('selected');
    expect(doc).toContain('quote_found');
  });
  it('current comments use persistent IDs and legacy anchors are preservation-only', () => {
    const text = doc.replace(/\s+/g, ' ');
    expect(text).toContain("sidecar relations to the node's persistent BODY `id`");
    expect(text).toContain('preserve an existing value with its element');
    expect(text).toContain('never author, change or reuse one');
    expect(text).toContain('New comments do not add it');
  });
  /*
   * Forking is an AGENT verb, and the thing an agent needs is
   * not the address — the registry renders that — but WHEN to reach for it:
   * the create/edit loop is where a document that already exists gets adapted.
   */
  it('teaches forking as the way to adapt a document you can read', () => {
    expect(doc).toContain('afbin fork <ref>');
    expect(doc).toContain('forked_from');
    expect(doc).not.toContain('afbin api');
  });
  /*
   * The social preview's mechanism lives here,
   * beside export, where markup.md's link points.
   *
   * The screenshot copy it replaced taught two loops: "only export if you can view
   * images; otherwise read the stored markup" sent an agent back to re-read
   * what it had just written, and `--page 2` "for one deck slide" turned a
   * five-slide deck into five exports. The push receipt is the check; one
   * whole-document image is the look.
   */
  it('the social preview mechanism is documented where the link points', () => {
    const versions = renderDoc('artifactbin/references/publishing-versions.md', BASE);
    expect(versions).toContain('artifactbin:og-image');
    expect(versions).toContain('artifactbin:og-crop');
    expect(versions).toContain('artifactbin:og-image-crop');
    expect(versions).toContain('<Helmet>');
  });
  it('export teaches the whole document in one image, never a slide at a time', () => {
    const flat = doc.replace(/\s+/g, ' ');
    for (const gone of ['read the stored markup', 'one deck slide', '--page 2', 'if you can view images']) {
      expect(flat, gone).not.toContain(gone);
    }
    expect(flat).toContain('A successful push is the check');
    expect(flat).toContain('shows the whole document, every slide, in one image');
    expect(flat).toContain('never one slide at a time');
  });
  it('error table carries image_fetch_failed and dataset_read_only', () => {
    const errors = renderDoc('artifactbin/references/errors.md', BASE);
    expect(errors).toContain('image_fetch_failed');
    expect(errors).toContain('dataset_read_only');
  });
  /*
   * A `<Mutation>` needs a dataset published `access: readwrite`, and every
   * reference that said so named a setting with no CLI door: an agent driving
   * afbin could read the requirement and have no way to meet it. Each mention
   * now names the flag that sets it.
   */
  it('every writable-dataset mention names the push flag that sets it', () => {
    const datasets = renderDoc('artifactbin/references/publishing-datasets.md', BASE);
    expect(datasets).toContain('--type dataset --access readwrite');
    const editing = renderDoc('artifactbin/references/markup-editing.md', BASE);
    const data = renderDoc('artifactbin/references/markup-data.md', BASE);
    for (const text of [editing, data]) {
      expect(text).toContain('--access readwrite');
      expect(text).not.toMatch(/`access: readwrite`/);
    }
    expect(renderDoc('artifactbin/references/errors.md', BASE)).toContain('--access readwrite');
  });
  /*
   * Measured on a tracker task: asked for a page "anyone opening the link" can update, an agent
   * spent 24 messages reverse-engineering the YAML field and fighting a pull, because the catalogs
   * doc named a data policy with no CLI path to it. One command sets it.
   */
  it('the catalogs doc names the one command that publishes a dataset viewers can write', () => {
    const databases = renderDoc('artifactbin/references/databases.md', BASE);
    expect(databases).toContain('--access readwrite --policy viewers-write');
    // UI-era instructions an afbin-driven agent cannot follow.
    expect(databases).not.toContain('/datasets/new');
    expect(databases).not.toContain('set_dataset_policy');
    expect(databases).not.toContain('get_dataset_policy');
    // And how to GET that YAML for a dataset already published from a CSV.
    expect(databases).toContain('afbin pull <id> --type dataset --output tasks.yaml');
  });
  /*
   * Measured on a multi-user page: `--policy viewers-write` is taught as the normal way to make a
   * dataset writable, and every re-push of one then answered a bare 404 — so the docs taught a
   * one-way door. They now say whose the re-push is, that the grant survives it, and how to read an
   * old version, because a governed dataset is the one thing that cannot be reverted.
   */
  it('the dataset docs say a governed dataset is still the owner’s to re-push, and how to read an old version', () => {
    const doc = renderDoc('artifactbin/references/publishing-datasets.md', BASE);
    expect(doc).toMatch(/owner/i);
    expect(doc).toContain('policy_locked');
    expect(doc).toContain('afbin pull <id>@<v> --output -');
    expect(doc).toContain('afbin fork <id>@<v>');
    // An empty table is a real starting state — the alternative authors reached for was a fake row.
    expect(doc).toContain('rows={[]}');
    // Said in the DATASETS reference and not in the catalogs one, because
    // `databases.md` renders 18 bytes under the per-file reading budget that
    // skill-tree.test.ts sweeps (SKILL_FILE_MAX_BYTES). Whoever frees space
    // there should carry these two facts across; until then this is the copy.
  });
});

/*
 * Three claims folders make load-bearing, each
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
  it('unlisted is listed nowhere — a folder page included', () => {
    expect(flat(doc)).toContain('unlisted artifact is excluded from public listings, a folder page included');
  });
  it('delete is a trash, and restore is named', () => {
    expect(doc).toContain('Delete is a trash');
    expect(doc).toContain('push --restore');
    expect(flat(doc)).toContain('restorable with no deadline');
  });
  /*
   * THE THREE CONSEQUENCES OF HAVING NO PURGE. Each is a promise an agent may
   * repeat to its user: there is no retention, deleting frees no quota, and the
   * only real erasure is an operator's, outside this API. A doc that stops
   * saying one of them is a doc that lets an agent promise something untrue.
   */
  it('a deleted COMMENT is not erased either — and an agent cannot undo one', () => {
    expect(flat(doc)).toContain('A deleted thread is not erased');
    expect(flat(doc)).toContain('there is no undo for it here');
  });
  it('nothing is ever erased, and the docs say so three ways', () => {
    expect(flat(doc)).toContain('Actual erasure is an administrative act');
    expect(flat(doc)).toContain('still counts against your quota');
    expect(flat(doc)).toContain('an administrative act on the database, outside this API');
    expect(flat(doc), 'no retention survives anywhere in the docs').not.toContain('30 days');
  });
  it('the two limits are stated, not implied away', () => {
    expect(flat(doc)).toContain('A restore can land a row deeper than the 6-level cap');
  });
  /*
   * A folder was once a DOCUMENT — created with a two-line
   * scaffold as its stored source — and the docs said so: "A folder's page is
   * its own stored markup … so you edit one like any document." It carries no
   * content now, and its page is rendered by the app. That sentence is the
   * shape of wrong claim this file exists for: an agent does not read past it,
   * it acts on it, and the act is a `not_editable` on a document it was told
   * it could edit. So the replacement is pinned by NAME, both halves — what a
   * folder has (nothing) and what its PUT will take.
   */
  it('a folder has NO content, and the page is not something you edit', () => {
    expect(flat(doc)).toContain('A folder has no content');
    expect(flat(doc)).toContain('Only title, visibility and folder are editable');
    expect(flat(doc), 'the scaffold is gone').not.toContain('its own stored markup');
    expect(flat(doc), 'a folder is not edited like a document').not.toContain('edit one like any document');
  });
});

describe('the markup skill', () => {
  const doc = buildMarkupDoc(BASE);
  it('markdown is refused, never "auto-converted"', () => {
    expect(doc).not.toContain('auto-converted');
  });
  it('a <Video poster> web URL is imported, not rejected', () => {
    expect(doc).not.toContain('thumbnail URLs are rejected');
  });
  it('<Number> documents suffix and that agg defaults to first', () => {
    expect(doc).toMatch(/suffix/);
    expect(doc).toMatch(/agg[^\n]*(defaults? to|default[^\n]*)`first`/);
  });
  it('omissions: all 8 shipped recipes are named', () => {
    for (const r of ['trend', 'funnel', 'waterfall', 'radar', 'combo', 'single-value', 'choropleth', 'point-map']) {
      expect(doc, `minusx/${r}@1`).toContain(`minusx/${r}@1`);
    }
  });
  it('props are not validated — the allowlist section says so', () => {
    expect(doc).toMatch(/props are not validated|unknown props? (are|is) (ignored|not validated)/i);
  });
  it('the CSP paragraph names the four endpoints', () => {
    expect(doc).not.toContain('the one URL its CSP admits');
  });
  /*
   * The JSX MICRO-RULES — a tag closes, a comment is
   * `{/* … *\/}`, and there is no document shell — are the two mistakes an
   * HTML-habit model makes on its first write (`<br>`, `<!-- -->`), and without
   * them the only thing that catches one is a 400 round trip. They live in
   * markup.md, which owns the vocabulary.
   */
  it('the JSX micro-rules are documented: closing tags, JSX comments, no document shell', () => {
    expect(doc).toContain('every tag closes (`<br />`)');
    expect(doc).toContain('{/* … */}');
    expect(doc).toContain('`<html>`');
  });
  /*
   * Two sentences an afbin agent could not act on.
   *
   * "top-level fields of the publish call" is the HTTP body's name for them.
   * The agent writes theme/template/colorMode in the file's YAML fence and
   * pushes; nothing in this doc said where they go.
   *
   * "Social preview: upload and crop" pointed at publishing-versions.md, which
   * says nothing about either — while the real path is three `<meta>` tags in
   * `<Helmet>` (lib/story/social-preview reads them out of the document
   * source), documented nowhere. A pointer to a doc that does not answer costs
   * the turns of reading it and still leaves the agent without the mechanism.
   *
   * The explanation lives WHERE THAT LINK POINTS — the generated
   * publishing-versions.md, beside export — because markup.md is at its 8 KB
   * reading budget and this is publication, not authoring grammar. markup.md
   * keeps a pointer that still names the metas, so an agent grepping the
   * authoring reference for `og-image` finds the thread rather than nothing.
   */
  it('the publish-time fields are named where the agent writes them: the YAML fence', () => {
    expect(doc.replace(/\s+/g, ' ')).toContain('`theme`, `template` and `colorMode` are top-level fields of the YAML fence');
  });
  it('markup.md points at the social-preview metas and at the doc that explains them', () => {
    expect(doc).toContain('artifactbin:og-image');
    expect(doc).toContain('artifactbin:og-image-crop');
    expect(doc).toContain('publishing-versions.md');
    expect(doc).not.toContain('[upload and crop](publishing-versions.md)');
  });
});

/*
 * A web URL in an image position is never REWRITTEN to `ref:<id>` — publish
 * stores a copy and the author's URL stays in the source, byte for byte,
 * because an agent reads back what it wrote. Four surfaces promised the
 * rewrite in four wordings (markup.md, markup-video.md, publishing-datasets.md
 * and the tool schema); a doc that teaches a retired mechanic is worse than
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
    expect(flat(markup)).toContain('In parent markup only `<img src>`, `<Video poster>` and `<File src>` take a URL');
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
    expect(flat(publishing)).toContain('never appears in `afbin list`');
  });
  it('the byte quota is the account\'s, and the first importer pays once', () => {
    expect(flat(publishing)).toContain('count against your ACCOUNT\'s byte quota');
    expect(flat(publishing)).toContain('charged once, to whoever first named the URL');
  });
  it('the imageUrl field guidance keeps the URL rather than promising a ref: rewrite', () => {
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
 * An agent answering a comment reads publishing-annotations.md and nothing
 * else — measured, on a run where every reply signed itself "Agent". The auth
 * reference owns the header; the file an agent is actually in has to NAME it.
 */
describe('the design skill', () => {
  const doc = buildDesignDoc(BASE);
  it('numbers bind through <Query> → data="$name", never a `ref:` dataset', () => {
    expect(doc).not.toContain('binds to a real `ref:` dataset');
    expect(doc).toContain('<Query');
  });
  it('the web-font route is the Helmet meta, not a data: URI', () => {
    expect(doc).toContain('name="font-display"');
  });
  it('color mode is the root class, not prefers-color-scheme', () => {
    expect(doc).not.toContain('prefers-color-scheme');
  });
});

describe('template pages', () => {
  it('every skeleton PUBLISHES — run through the validator the door uses', async () => {
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
  it('editorial no longer says remote image URLs are rejected', () => {
    // Whitespace-collapsed: the YAML wraps prose, and the first version of this
    // assertion passed against the WRONG page because the phrase broke across a line.
    expect(buildTemplateDoc(BASE, 'editorial')!.replace(/\s+/g, ' ')).not.toContain('remote URLs are rejected');
  });
});

describe('the quick sheet', () => {
  const sheet = buildQuickSheet(BASE);
  it('says a dangerous tag (form/iframe/meta…) is refused WITHOUT the allowlist', () => {
    expect(sheet).toMatch(/<form>|form,? iframe|iframe, ?meta|form\/iframe/i);
  });
  it('a CDN script or external stylesheet is a 400, not a silent failure', () => {
    expect(sheet).not.toMatch(/silently fail/);
  });
  it('the sheet teaches the second write as /edits, not a whole-document PUT', () => {
    expect(sheet).not.toContain('simply replace');
  });
});

/**
 * The docs teach the reader's link, because it is the whole point of the
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
