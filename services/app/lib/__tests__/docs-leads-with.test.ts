/**
 * Every docs file LEADS with its critical content — the rule the old
 * `/docs/llm` was reordered to follow, kept for the tree so no file drifts
 * back to configuration-before-vocabulary.
 *
 * Measured before this test existed: `/docs/markup` put both allowlists at
 * 83% and its only skeleton at 90% of the page; the templates and themes
 * indexes put their link lists — the one thing the page is for — LAST; the
 * start brief forbade `h-screen`, which the platform rewrites on every path.
 * Agents read the first slice of a page (`sed -n '1,240p'`, `head -c 6000`)
 * and act on it, so where a fact sits IS whether it is read.
 *
 * The generic half — every file opens with `## Read first`, bounded — lives in
 * skill-tree.test.ts. This is the per-file half: fingerprint-within-N-bytes,
 * with byte budgets that are the measured cut points, not round numbers.
 */
import { describe, it, expect } from 'vitest';
import { buildDocsIndex, buildQuickSheet, renderDoc, DOCS_INDEX_MAX_BYTES } from '../skills';
import { STORY_TEMPLATES } from '../data/story/story-templates';
import { STORY_THEMES } from '../data/story/story-themes';

const BASE = 'https://example.test';
const head = (doc: string, bytes: number) => Buffer.from(doc, 'utf8').subarray(0, bytes).toString('utf8');
const within = (doc: string, bytes: number, needle: string) =>
  expect(head(doc, bytes), `"${needle}" must sit within the first ${bytes} bytes`).toContain(needle);

describe('/llms.txt and /docs are ONE small listing — never a second copy of a large doc', () => {
  const index = buildDocsIndex(BASE);
  it('is small enough to cost nothing to fetch twice', () => {
    expect(Buffer.byteLength(index)).toBeLessThanOrEqual(DOCS_INDEX_MAX_BYTES);
  });
  it('lists every skill, the brief first, then the API', () => {
    const pages = ['/docs/artifactbin/SKILL.md', '/docs/artifactbin/references/design.md', '/docs/artifactbin/references/markup.md', '/docs/artifactbin/references/publishing.md', '/docs/artifactbin/references/templates.md', '/docs/artifactbin/references/themes.md'];
    let last = -1;
    for (const page of pages) {
      const at = index.indexOf(`${BASE}${page}`);
      expect(at, `${page} must be linked`).toBeGreaterThan(-1);
      expect(at, `${page} must come after the previous page`).toBeGreaterThan(last);
      last = at;
    }
  });
  it('says the critical content is at the TOP — once, about all of them', () => {
    expect(index.toLowerCase()).toMatch(/critical[^\n]{0,40}at the top/);
  });
  it('is not the protocol doc', () => {
    expect(index).not.toContain('## Endpoints');
    expect(index).not.toContain('POST ' + BASE + '/api/artifacts');
  });
});

describe('the publishing skill opens with the essentials', () => {
  const doc = renderDoc('artifactbin/references/publishing.md', BASE);
  it('the first 2,000 bytes carry the publish call, the bearer rule, and where the rest is', () => {
    within(doc, 2000, `POST ${BASE}/api/artifacts`);
    within(doc, 2000, 'Every `/api` call, `GET` included');
    within(doc, 2000, '[auth](publishing-auth.md)');
    within(doc, 2000, '[datasets](publishing-datasets.md)');
    within(doc, 2000, '[markup.md](markup.md)');
  });
  it('`head -c 6000` really is the whole briefing (rules, create, the public-link fix)', () => {
    within(doc, 6000, '## Rules every document lives by');
    within(doc, 6000, '### Create an artifact');
    // The FIX sentence, not the example line that merely shows the field.
    within(doc, 6000, '`"visibility": "public"` or `"unlisted"`');
  });
});

describe('the markup skill teaches vocabulary before configuration', () => {
  const doc = renderDoc('artifactbin/references/markup.md', BASE);
  it('the wrapper, the skeleton and both allowlists sit inside the first 5,000 bytes', () => {
    within(doc, 5000, 'data-design="tw"');
    within(doc, 5000, '## Skeleton');
    within(doc, 5000, 'complete allowlist');
  });
  it('the Helmet/CSS/script configuration comes AFTER the skeleton', () => {
    expect(doc.indexOf('## `<Helmet>`')).toBeGreaterThan(doc.indexOf('## Skeleton'));
  });
});

describe('the templates and themes indexes lead with their links', () => {
  it('templates: the first link is within 400 bytes', () => {
    within(renderDoc('artifactbin/references/templates.md', BASE), 400, '](templates-editorial.md)');
  });
  it('themes: the first link is within 400 bytes', () => {
    within(renderDoc('artifactbin/references/themes.md', BASE), 400, '](themes-modernist.md)');
  });
});

describe('each template file puts the skeleton — the thing that gets copied — in its top half', () => {
  for (const t of STORY_TEMPLATES) {
    it(`${t.name}`, () => {
      const doc = renderDoc(`artifactbin/references/templates-${t.name}.md`, BASE);
      const lines = doc.split('\n');
      const first = lines.findIndex((l) => /^\s{2,}</.test(l));
      expect(first, `${t.name} has no skeleton block`).toBeGreaterThan(-1);
      expect(first / lines.length, `${t.name}: skeleton starts at line ${first + 1} of ${lines.length}`).toBeLessThan(0.5);
    });
  }
});

describe('each theme file leads with its identity', () => {
  for (const t of STORY_THEMES) {
    it(`${t.name}: description, fonts and default mode in the first 400 bytes`, () => {
      const doc = renderDoc(`artifactbin/references/themes-${t.name}.md`, BASE);
      within(doc, 400, t.description);
      within(doc, 400, 'Fonts:');
      within(doc, 400, 'Default mode:');
    });
  }
});

describe('the design skill leads with the rules an agent can act on', () => {
  const doc = renderDoc('artifactbin/references/design.md', BASE);
  it('the supported web-font route is taught, and inside the first 1,500 bytes', () => {
    within(doc, 1500, 'name="font-display"');
  });
  it('no longer sends agents to a data: URI font blob or prefers-color-scheme', () => {
    expect(doc).not.toContain('prefers-color-scheme');
    expect(doc).not.toMatch(/data:[^\n]*@font-face|@font-face[^\n]*data:/);
  });
});

describe('the brief — the one text every agent reads', () => {
  const sheet = buildQuickSheet(BASE);
  it('carries the data vocabulary a dashboard needs (Query over ref_, bound by $name)', () => {
    expect(sheet).toContain('<Query');
    expect(sheet).toContain('ref_');
    expect(sheet).toContain('data="$');
  });
  it('does not forbid h-screen / vh — the platform rewrites both on every path', () => {
    expect(sheet).not.toMatch(/never vh/i);
  });
  it('the hard rules and the data block are adjacent — no theme prose between them', () => {
    const rules = sheet.indexOf('self-contained');
    const data = sheet.indexOf('<Query');
    const theme = sheet.indexOf('**theme**');
    expect(rules).toBeGreaterThan(-1);
    expect(Math.abs(data - rules)).toBeLessThan(2500);
    expect(theme).toBeGreaterThan(Math.min(rules, data));
  });
});
