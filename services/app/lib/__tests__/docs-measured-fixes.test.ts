/**
 * Three lines and one budget, each MEASURED before it was written
 * (~/projects/improved-skills-v2.md §15, pi + OpenCode, 3 runs per arm):
 *
 * - The brief's deck bullet shows the whole FRAME — `<Helmet>` first at top
 *   level, the `px-6 @2xl:px-12` wrapper, `<Slide className="py-14">`. With
 *   it 6/6 runs framed the deck on the first write; without it 1/6, and every
 *   harness shipped text flush to the viewport edge with `<Helmet>` inside
 *   `<SlideDeck>` (the door hoists it: `canonical_stable` false).
 * - Every theme page names the TOKEN CLASS its "accent" means. pi spent 11
 *   turns grepping four pages for `--accent` because the industry page said
 *   "safety orange" five times and never a class.
 * - "Every `/api` call, `GET` included, sends the bearer" — two harnesses read
 *   their own artifact back without it, got a 401 and retried, on four tasks.
 * - The four template pages fit the 8,192 B always-read cap by EDITING (no
 *   rule dropped — `skills-v2-validation/trimmed/REPORT.md`), corpus −8.9%,
 *   OpenCode −44% cost, pi −23%.
 */
import { describe, it, expect } from 'vitest';
import { buildQuickSheet, renderDoc } from '../skills';

const buildThemeDoc = (base: string, name: string) => renderDoc(`artifact-bin/references/themes-${name}.md`, base);
const buildTemplateDoc = (base: string, name: string) => renderDoc(`artifact-bin/references/templates-${name}.md`, base);
import { STORY_THEMES } from '../data/story/story-themes';
import { STORY_TEMPLATES } from '../data/story/story-templates';

const BASE = 'https://example.test';

/**
 * The deck FRAME (measured: 6/6 runs framed with it in reach, 1/6 without —
 * every harness shipped flush-edge decks with `<Helmet>` inside `<SlideDeck>`
 * while the frame lived in a file the brief said not to fetch). The regime
 * changed with the dispatch table: the brief is HIGH-LEVEL (what each genre
 * is, when to pick it) and ROUTES a genre author to the template file BEFORE
 * writing — so the load-bearing pair is that routing sentence in the brief
 * plus the frame itself in its owner file.
 */
describe('the deck FRAME: the brief routes to it, the template file carries it', () => {
  it('the brief tells a genre author to read the template file BEFORE writing, naming the cost of skipping', () => {
    const sheet = buildQuickSheet(BASE);
    expect(sheet).toMatch(/Before writing[^\n]*read/i);
    expect(sheet).toContain('references/templates-<name>.md');
    expect(sheet).toMatch(/flush to the\s+viewport edge/);
  });
  it('templates-deck.md says <Helmet> sits first at top level, never inside <SlideDeck>', () => {
    const deck = buildTemplateDoc(BASE, 'deck')!;
    expect(deck).toMatch(/`<Helmet>`[^\n]*(FIRST|first)[^\n]*top-level/);
    expect(deck).toMatch(/never inside/);
  });
  it('templates-deck.md shows the wrapper as the only side padding and the slide padding class', () => {
    const deck = buildTemplateDoc(BASE, 'deck')!;
    expect(deck).toContain('className="@container px-6 @2xl:px-12"');
    expect(deck).toMatch(/<Slide[^\n]*className="[^"]*py-\d+/);
  });
});

describe('every theme page names the token class its accent means', () => {
  for (const theme of STORY_THEMES) {
    it(`${theme.name}`, () => {
      const page = buildThemeDoc(BASE, theme.name)!;
      expect(page).toMatch(/Tokens:/);
      expect(page).toMatch(/text-primary/);
      expect(page).toMatch(/bg-primary/);
      expect(buildThemeDoc(BASE, theme.name)).not.toBeNull();
    });
  }
});

describe('the brief says the bearer travels on EVERY /api call, GET included', () => {
  it('in one line', () => {
    const sheet = buildQuickSheet(BASE);
    expect(sheet).toMatch(/Every `\/api` call, `GET` included, sends `Authorization: Bearer/);
  });
});

describe('the four template pages fit the always-read cap by editing', () => {
  for (const t of STORY_TEMPLATES) {
    it(`${t.name} ≤ 8,192 B`, () => {
      expect(Buffer.byteLength(buildTemplateDoc(BASE, t.name))).toBeLessThanOrEqual(8192);
    });
  }
});
