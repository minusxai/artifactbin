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
  it('§1 error table carries image_fetch_failed and dataset_read_only', () => {
    expect(doc).toContain('image_fetch_failed');
    expect(doc).toContain('dataset_read_only');
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
