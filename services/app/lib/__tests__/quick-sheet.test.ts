/**
 * The quick sheet is the START BRIEF's own reference: enough to publish a good
 * document with NO further fetches, and a pointer for everything else.
 *
 * Measured, which is why it exists: the full docs path costs an agent ~62 KB
 * across 7 pages before it writes a byte, and that corpus is replayed in every
 * later turn (a 300k-token deck run). The same task with a ~4 KB sheet inline
 * published the same deck for 18k tokens.
 *
 * These pin the two things that make it safe: it teaches only the CURRENT
 * vocabulary (a retired key taught here is worse than not teaching it), and it
 * cannot silently regrow into a second copy of /docs/llm.
 */
import { describe, it, expect } from 'vitest';
import { buildQuickSheet, QUICK_SHEET_MAX_BYTES, renderTree, skillTree } from '@/lib/skills';
import { STORY_THEME_NAMES, STORY_TEMPLATE_NAMES } from '@/lib/validation/atlas-schemas';
/** The reference the sheet is a shortcut for: every reference file of the tree. */
const buildSkillDoc = (b: string) => renderTree(skillTree(), b).filter((x) => x.file.ref).map((x) => x.text).join('\n');

const base = 'https://artifactbin.dev';
const sheet = buildQuickSheet(base);

describe('the quick sheet', () => {
  it('stays within its size budget — it is a shortcut, not a second protocol doc', () => {
    expect(Buffer.byteLength(sheet, 'utf8')).toBeLessThanOrEqual(QUICK_SHEET_MAX_BYTES);
    // And stays a SHORTCUT relative to the thing it saves reading: past about a
    // third of /docs/llm, fetching the real reference is the cheaper move and
    // this has quietly become a worse copy of it.
    expect(Buffer.byteLength(sheet, 'utf8')).toBeLessThan(Buffer.byteLength(buildSkillDoc(base), 'utf8') / 3);
  });

  /**
   * The sheet lives at ONE address and teaches the CREATE call — the reader
   * with an existing document arrives from a start brief that already told it
   * to PUT/edit that document, so the sheet no longer forks on artifactId.
   */
  it('teaches the publish call and that the title is what a tab and a link preview show', () => {
    expect(sheet).toContain('POST');
    expect(sheet).toContain(`${base}/api/artifacts`);
    expect(sheet).toContain('Authorization: Bearer');
    expect(sheet).toMatch(/title/i);
  });

  /**
   * Caught by measurement, not by reading: with the sheet alone, Opus 5
   * published a deck whose stat grids were `grid-cols-3` unprefixed and used
   * `sm:` — and the document did not fit a 390px phone. A document renders
   * inside a CONTAINER, so the viewport prefixes do not apply, and the full
   * template docs say so where the sheet did not.
   */
  it('teaches phone width: container prefixes, and grids that start at one column', () => {
    expect(sheet).toMatch(/@2xl:|@container/);
    expect(sheet).toMatch(/390|phone/i);
    expect(sheet).toContain('grid-cols-1');
  });

  it('teaches the two things a checking agent needs: the conditional echo and the per-slide shot', () => {
    expect(sheet).toContain('markup_changed');
    expect(sheet).toContain('slide=');
  });

  it('names every theme and every template, from the registries rather than a hand-kept list', () => {
    for (const name of STORY_THEME_NAMES) expect(sheet).toContain(name);
    for (const name of STORY_TEMPLATE_NAMES) expect(sheet).toContain(name);
  });

  /**
   * The template section is HIGH-LEVEL by design (what each genre is, when to
   * pick it) — the grammar lives in `templates-<name>.md`, one dispatch row
   * away, and the brief ROUTES a genre author there before writing.
   */
  it('names each template with enough identity to pick, and routes to the file for the grammar', () => {
    expect(sheet).toMatch(/max-w-2xl/);       // editorial's one centered column
    expect(sheet).toMatch(/<Grid/);           // dashboard tiles
    expect(sheet).toMatch(/one idea per slide/i); // deck's identity
    expect(sheet).toContain('references/templates-<name>.md');
  });

  /**
   * Navigation is a PROCEDURE, not only a lookup table: after the sheet, read
   * design (the craft), then markup (the vocabulary), then the picked
   * template and theme. The order is the contract — pinned by position.
   */
  it('documents the reading path in order: design → markup → the picked template and theme', () => {
    const at = (s: string) => { const i = sheet.indexOf(s); expect(i, `${s} missing from the path`).toBeGreaterThan(-1); return i; };
    const design = at('references/design.md');
    const markup = at('references/markup.md');
    const template = at('references/templates-<name>.md');
    const theme = at('references/themes-<name>.md');
    expect(design).toBeLessThan(markup);
    expect(markup).toBeLessThan(template);
    expect(markup).toBeLessThan(theme);
  });

  /**
   * The chart embeds get theme palettes, tooltips, responsive sizing and live
   * re-runs for free — a hand-rolled `<svg>` chart gets none of it. The sheet
   * says so and routes ALL dataviz to markup-data.md first.
   */
  it('routes dataviz to markup-data.md and forbids hand-rolled svg charts', () => {
    expect(sheet).toMatch(/dataviz[^\n]*[\s\S]{0,80}`references\/markup-data\.md` first/i);
    expect(sheet).toMatch(/never a hand-rolled `<svg>` chart/i);
    expect(sheet).toContain('vega-lite');
  });

  it('teaches the rules a document actually lives by', () => {
    expect(sheet).toContain('className');
    expect(sheet).toMatch(/inline\s+`?style/i);
    expect(sheet).toContain('<Helmet>');
  });

  /**
   * Measured on a live run: an agent handed the sheet still fetched
   * /docs/markup "to make sure I use the deck components correctly". A sheet
   * that leaves the vocabulary uncertain sends the agent to the 27 KB page
   * regardless — so it must name the kit AND say that a wrong guess is a 400
   * carrying the whole allowed set, which is what makes guessing cheaper than
   * reading.
   */
  it('makes guessing safe, so the component list is not worth fetching', () => {
    expect(sheet).toMatch(/allowed_html_tags/);
    expect(sheet).toMatch(/guess/i);
    for (const kit of ['Card', 'Grid', 'Question', 'DataTable']) expect(sheet).toContain(kit);
  });

  /**
   * This test used to demand the OPPOSITE — that the sheet say "do not fetch"
   * — and the production matrix showed what that costs. Told not to fetch, and
   * then wanting the component list for a deck, Claude Code did not fetch: it
   * guessed `/api/docs`, `/api/components`, `/api/artifacts/<id>/schema` and
   * `/llms.txt`, failed `no_unknown_endpoints`, and reached `/docs/llm` on its
   * tenth request.
   *
   * A prohibition does not stop an agent needing something; it stops it
   * asking. Say the sheet is usually enough — that part was right and stays —
   * and then say plainly where the rest is.
   */
  it('says the sheet is usually enough WITHOUT forbidding the fetch', () => {
    expect(sheet).toMatch(/fully covered|usually the whole job/i);
    expect(sheet).not.toMatch(/do not fetch|don't fetch|never fetch/i);
  });

  /**
   * Measured on the 4×4 acceptance run, and the reason this exists: on the
   * DATA task (a dashboard reading a dataset) the sheet made things WORSE.
   * Pi obeyed "do not fetch the full reference", never read /docs/llm, and
   * went looking for an API description that does not exist — /api/docs,
   * /api/openapi.json, /api/swagger.json, /api — then failed publish three
   * times on invalid_jsx: 51 requests and 1.7M tokens against 385k before.
   * The hatch only fires when the agent knows it is off the map, so the sheet
   * has to SAY which work is off the map.
   */
  it('names the work it does not cover, so an agent knows when to go to the docs', () => {
    // The refusal to fetch and its EXCEPTION must live in the same breath — an
    // agent reads the instruction, not the page.
    const para = sheet.split(/\n\s*\n/).find((p) => /each ask has ONE file/i.test(p)) ?? '';
    expect(para).toMatch(/data|dataset|chart/i);
    expect(para).toContain('/docs');
    // And it must not CLAIM to cover a document that reads data: that claim is
    // what sent Pi hunting for /api/openapi.json instead of the docs.
    expect(sheet).not.toMatch(/deck, report, dashboard or prose/i);
  });

  /**
   * The same run: opencode's deck did not fit a 390px phone. No grid, no table,
   * no fixed width — an unprefixed `text-6xl` headline carrying a 15-character
   * proper noun, which is 60px type on a 390px screen. Sizes have to start
   * small and grow, exactly like the columns do.
   */
  it('teaches display type that starts at phone size and grows', () => {
    expect(sheet).toMatch(/text-4xl @2xl:|text-3xl @2xl:|@2xl:text-/);
  });

  it('points at the full reference as an ESCAPE HATCH — the sheet never claims to be complete', () => {
    expect(sheet).toContain(`${base}/docs`);
    expect(sheet).toContain(`${base}/docs/artifact-bin/references/`);
    expect(sheet).toMatch(/only if|not covered|beyond/i);
  });

  it('does not teach retired vocabulary', () => {
    for (const dead of ['<Param', 'filters=', '"markdown"', '"html"', 'data="ref:']) {
      expect(sheet).not.toContain(dead);
    }
  });

  it('tells an agent that cannot see images not to fetch its own render', () => {
    expect(sheet).toMatch(/view images|cannot see/i);
  });
});

/**
 * The sheet used to say "`class=` must be `className=`", which is not true —
 * the interpreter maps `class`, and `<div class="p-4">ok</div>` publishes 201
 * and paints. The repair is not to document both spellings: the sheet is a
 * BRIEFING, and its value is that there is one way to do each thing. It names
 * `className` and says nothing about `class`, which is a rule an agent can
 * follow without a choice to make, and true.
 */
describe('the sheet gives one path per thing, and no false ones', () => {
  it('names className without inventing a prohibition on class', () => {
    const s = buildQuickSheet('https://ex.test');
    expect(s).toContain('className');
    expect(s).not.toMatch(/`class=` must be/);
    expect(s).not.toMatch(/`class=?`? (also )?works|both work/i);
  });
});

/**
 * The sheet covered publishing and not EDITING, which is the other half of what
 * an agent does with a document it already made. Measured: in plugins mode —
 * where the sheet is all an agent starts with — the `edit` task failed
 * `used_edits_endpoint` for every agent that ran it, while copy-text passed it
 * four times out of four by fetching the full reference. The cheapest repair is
 * the four lines that name the call, not another fetch.
 */
describe('the sheet covers editing, not only publishing', () => {
  const s = buildQuickSheet('https://ex.test');

  it('names the edits endpoint and what it needs', () => {
    expect(s).toContain('/edits');
    expect(s).toContain('edit_id');
    expect(s).toMatch(/old_string/);
    expect(s).toMatch(/new_string/);
  });

  it('stays inside its byte budget', () => {
    expect(Buffer.byteLength(s)).toBeLessThanOrEqual(QUICK_SHEET_MAX_BYTES);
  });
});
