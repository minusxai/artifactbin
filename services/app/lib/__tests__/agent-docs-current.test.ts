/**
 * EVERY surface we expose to an agent, checked against the rules the door
 * actually enforces.
 *
 * This exists because the docs drifted apart and only the one I happened to
 * read got fixed. An agent handed a working interactive HTML page reasoned:
 * "This platform can't take the original's hand-rolled JS — static JSX, no
 * event handlers", and rewrote it as data embeds. It was right to believe us:
 * `/docs/markup` said "no `<script>`" and never mentioned `<Helmet>` at all,
 * written before a document could carry a script. `/docs/llm` said the
 * opposite, correctly, in the same deployment.
 *
 * So the rule is checked ACROSS the surfaces rather than one at a time: a doc
 * may not deny a capability the door allows, nor teach a shape the door
 * rejects. Add a builder here when you add one.
 */
import { describe, it, expect } from 'vitest';
import { buildMcpInstructions, buildQuickSheet, renderDoc, renderTree, skillTree } from '../skills';

const BASE = 'https://example.test';
const files = (...paths: string[]) => (base: string) => paths.map((p) => renderDoc(p, base)).join('\n');
/** The publishing skill as one text (what /docs/llm used to be). */
const buildSkillDoc = files('artifactbin/references/publishing.md', 'artifactbin/references/publishing-auth.md', 'artifactbin/references/publishing-datasets.md', 'artifactbin/references/publishing-annotations.md', 'artifactbin/references/publishing-versions.md', 'artifactbin/references/publishing-mcp.md');
const buildMarkupDoc = files('artifactbin/references/markup.md', 'artifactbin/references/markup-data.md', 'artifactbin/references/markup-motion.md', 'artifactbin/references/markup-video.md', 'artifactbin/references/markup-svg.md');
const buildDesignDoc = files('artifactbin/references/design.md');
const buildThemesDoc = files('artifactbin/references/themes.md');
const buildTemplatesDoc = files('artifactbin/references/templates.md');
const buildThemeDoc = (name: string, base: string) => renderDoc(`artifactbin/references/themes-${name}.md`, base);
const buildTemplateDoc = (name: string, base: string) => renderDoc(`artifactbin/references/templates-${name}.md`, base);
import { MARKUP_FIELD_GUIDANCE, MARKUP_STYLE_RULE } from '../agent-guidance';
import { parseJsx } from '../jsx';
import { validateJsx } from '../jsx/validate';
import { STORY_HTML_TAGS } from '../story-ui/component-names';

const SURFACES: Array<[string, string]> = [
  ['/docs/llm', buildSkillDoc(BASE)],
  ['/docs/markup', buildMarkupDoc(BASE)],
  ['/docs/artifact-design', buildDesignDoc(BASE)],
  ['/docs/themes', buildThemesDoc(BASE)],
  ['/docs/themes/<name>', buildThemeDoc('modernist', BASE)],
  ['/docs/templates', buildTemplatesDoc(BASE)],
  ['/docs/templates/<name>', buildTemplateDoc('editorial', BASE)],
  ['mcp instructions', buildMcpInstructions(BASE)],
  ['mcp markup field', MARKUP_FIELD_GUIDANCE],
  ['markup style rule', MARKUP_STYLE_RULE],
];

describe('no agent-facing doc denies a capability the door allows', () => {
  it.each(SURFACES)('%s never says a document cannot carry a script', (_name, text) => {
    expect(text).not.toMatch(/no\s+`?<script>/i);
  });

  it.each(SURFACES)('%s never teaches a body-level <style> block', (_name, text) => {
    expect(text).not.toMatch(/top-level\s+`?<?style/i);
    expect(text).not.toMatch(/ONE top-level style block/i);
  });

  // Only an OFFER counts: "there is no separate markdown or html tier" is the
  // sentence we want, not the one we are hunting.
  it.each(SURFACES)('%s never offers a retired tier', (_name, text) => {
    expect(text).not.toMatch(/html tier:|markdown input|<Markdown>|send (markdown|html)\b/i);
  });
});

describe('the reference teaches what a document CAN do', () => {
  const markup = buildMarkupDoc(BASE);

  it('names <Helmet> as the home of title, CSS and script', () => {
    expect(markup).toContain('<Helmet>');
    expect(markup).toContain('<script>');
  });

  it('connects the inline-handler ban to the mechanism that works', () => {
    expect(markup).toMatch(/declarative controls/);
    expect(markup).toContain('mx.params.subscribe');
    expect(markup).toMatch(/no visible DOM access/);
  });

  it('teaches CSS overrides in the Helmet block', () => {
    expect(markup).toMatch(/<Helmet>[\s\S]{0,400}<style>/);
  });

  it('and the themes doc points at the same one place', () => {
    expect(buildThemesDoc(BASE)).toMatch(/Helmet/);
  });
});

/**
 * SVG's `<title>` is the accessibility label for a graphic — a different
 * element that happens to share the name — and it stays legal inside an
 * `<svg>`. Saying only "a <title> in the body is refused" invites the wrong
 * repair: an agent debugging a blank page reasoned "likely the 25 SVG <title>
 * elements colliding with the Helmet <title> (docs allow only one)" and
 * stripped every icon label. They were never the problem (25 of them render
 * beside a Helmet title with one title in <head> and no hydration error), but
 * the doc gave it no way to know that.
 */
describe('the reference distinguishes SVG titles from the document title', () => {
  it('says an <svg> may keep its own <title>', () => {
    expect(buildMarkupDoc(BASE)).toMatch(/svg[^.]{0,80}<title>|<title>[^.]{0,80}svg/i);
  });
});

/**
 * The ERROR MESSAGES are agent-facing documentation too — more so than the
 * docs, because an agent reads them at the moment it is wrong. They drift the
 * same way: the inline-style rejection told authors to "put custom CSS in a
 * top-level <style> block" long after a body <style> started being refused,
 * which is a two-hop loop (rejected, follow the advice, rejected again).
 * Codex hit exactly this message on 92 attributes while porting a page.
 */
describe('the door never advises a shape the door rejects', () => {
  const messagesFor = (markup: string) => {
    const parsed = parseJsx(markup);
    if (!parsed.ok) return [];
    return validateJsx(parsed.nodes, {
      components: [],
      allowedHtmlTags: [...STORY_HTML_TAGS],
      stylePolicy: 'no-inline-style',
    }).map((e) => e.message);
  };

  it.each([
    ['inline style attribute', '<div style="color:red">x</div>'],
    ['a body <style> block', '<style>{`p{color:red}`}</style>'],
    ['a body <title>', '<p>x</p><title>t</title>'],
    ['a denied tag', '<form><input /></form>'],
  ])('the message for %s never points at a top-level <style>', (_label, markup) => {
    const msgs = messagesFor(markup);
    expect(msgs.length).toBeGreaterThan(0);
    for (const m of msgs) expect(m).not.toMatch(/top-level\s+`?<?style/i);
  });

  it('sends inline styles to the Helmet, the place that accepts them', () => {
    const [msg] = messagesFor('<div style="color:red">x</div>');
    expect(msg).toMatch(/className/);
    expect(msg).toMatch(/Helmet/);
  });
});

/**
 * A text-only model that fetches its own render hands its harness an image it
 * cannot accept: measured, one run 400ed and died AFTER publishing correctly.
 * A vision-capable agent should still look — it is why the best-looking
 * documents are the ones whose author checked.
 */
describe('the export section says WHEN to look', () => {
  it('tells an agent to fetch its render only if it can view images, and what to do otherwise', () => {
    const doc = buildSkillDoc(BASE);
    const section = doc.slice(doc.indexOf('## Screenshot / export'));
    expect(section).toMatch(/view images/i);
    expect(section).toMatch(/read the stored markup/i);
  });
});

/**
 * The echo is skipped when storing changed nothing — an agent told only "the
 * response echoes the stored markup" would read an absent field as data loss.
 */
describe('the write echo is documented as conditional', () => {
  it('names markup_changed and says when markup is present', () => {
    const doc = buildSkillDoc(BASE);
    expect(doc).toContain('markup_changed');
    expect(doc).toMatch(/only when|unchanged/i);
  });
});

/**
 * A deck is reviewed one slide at a time. Undocumented, an agent GUESSES —
 * measured: `?slide=2`, `?full=1`, `?mode=full`, `?print=1`, then a throwaway
 * one-slide document per look.
 */
describe('the export section teaches the per-slide shot', () => {
  it('names ?slide=N', () => {
    const doc = buildSkillDoc(BASE);
    const section = doc.slice(doc.indexOf('## Screenshot / export'));
    expect(section).toContain('slide=');
  });
});

/**
 * AGENTS TRUNCATE. Measured on the production matrix, on the DATA task: pi
 * fetched `/docs/llm` and read it with `head -c 6000`; opencode used
 * `head -100`. The data vocabulary — how a dataset is created and read back
 * with a `<Query>` — began at byte 15,493 of a 27,615-byte document, so both
 * of them wrote a dashboard having never seen it, and then failed publish
 * (opencode seven times, each retry replaying its whole context).
 *
 * A document an agent reads with `head` has a budget, and the vocabulary the
 * task needs has to be inside it. This is not a length rule — the full
 * reference stays as long as it needs to be — it is an ORDER rule.
 */
describe('the data vocabulary survives a truncating reader', () => {
  const HEAD = 6000; // what pi actually read

  it('teaches datasets and <Query> within the first bytes an agent is likely to read', () => {
    const head = buildQuickSheet(BASE).slice(0, HEAD);
    expect(head).toContain('<Query');
    expect(head).toMatch(/dataset/i);
    // And it must be usable, not a forward reference: the binding is what a
    // chart needs, so name it too.
    expect(head).toMatch(/data="\$/);
  });

  /**
   * The same budget covers the other two things a document cannot be written
   * without: how to publish it, and the rules it lives by (self-contained, no
   * CDN scripts, Helmet for CSS/JS). "Rules every document lives by" used to sit
   * at byte 24,807 of 28,489 — past every truncating reader in the matrix.
   */
  it('teaches the publish call and the document rules in the same budget', () => {
    const head = buildQuickSheet(BASE).slice(0, HEAD);
    expect(head).toMatch(/POST .*\/api\/artifacts/);
    expect(head).toContain('Authorization: Bearer');
    expect(head).toMatch(/self-contained/i);
    expect(head).toMatch(/No CDN/i);
    expect(head).toContain('<Helmet>');
  });

  /**
   * A reader who truncates does not always truncate from the FRONT. Measured
   * on the pi leg's dashboard task, its four reads of this page were
   * `head -c 12000`, a `grep` for section anchors, `tail -c 9000`, and then a
   * `sed` window — and the tail is the one that bought it nothing, because
   * what it was hunting (the data vocabulary, the document rules) is now at
   * the top. The end of the page is therefore a SIGNPOST back to the front,
   * which costs every other reader a line and saves that one a whole fetch.
   */
  it('every file is small enough that a tail-reader has read the whole thing', () => {
    // The old 28 KB page ended with a signpost back to its top; a file under
    // 8 KB IS the head, so the signpost is the size cap (lib/skills/tree).
    for (const { file, text } of renderTree(skillTree(), 'https://artifactbin.dev')) expect(Buffer.byteLength(text), file.path).toBeLessThanOrEqual(8192);
  });

  /**
   * ONE source for the data vocabulary. It briefly lived in a second page as
   * well, which is the drift this repo avoids everywhere else — the plugin
   * skills are GENERATED from these same functions for exactly that reason.
   */
  it('keeps the data path in one place — no second page to drift from', () => {
    expect(buildSkillDoc(BASE)).not.toContain('/docs/data');
  });
});

/**
 * AGENTS GUESS ADDRESSES. Measured on the production matrix, Claude Code —
 * given a start link and no index — probed `/llms.txt`, `/api/docs`,
 * `/api/components` and `/api/artifacts/<id>/schema` on the deck task, and
 * `/api/datasets`, `/api/datasets/list`, `/api/data`, `/api/files` and
 * `/api/refs` on the dashboard: nine 404s across two runs, and a failed
 * `no_unknown_endpoints` for each.
 *
 * Two of those guesses are worth answering rather than counting. `/llms.txt`
 * has a convention behind it, so it now serves the doc itself. The dataset
 * hunt was looking for something that already exists under another name, so
 * the listing section says what it lists.
 */
describe('the addresses agents guess', () => {
  it('tells an agent its datasets are in the artifact listing, so it stops hunting for an endpoint', () => {
    const doc = buildSkillDoc(BASE);
    const section = doc.slice(doc.indexOf('### List your artifacts'));
    expect(section).toMatch(/datasets/i);
    expect(section).toMatch(/no separate datasets endpoint|not only documents/i);
    expect(section).toContain('format');
  });
});

/**
 * THE SAME DEFECT, THREE TIMES IN ONE DAY — so it gets a guard rather than a
 * fourth fix.
 *
 * An agent-facing surface must never FORBID a look, and must never CLAIM to be
 * complete. Both read as helpful compression and both cost far more than they
 * save, because a prohibition does not stop an agent needing something — it
 * stops it asking, and it improvises instead:
 *
 *  - the start brief said "for a document of prose, slides or sections, do not
 *    fetch anything". Claude Code wanted a deck's component list, did not
 *    fetch, and guessed `/api/docs`, `/api/components`,
 *    `/api/artifacts/<id>/schema` and `/llms.txt` — failing
 *    `no_unknown_endpoints` and reaching `/docs/llm` on its tenth request.
 *  - the eval's plugins prompt said the skills "carry the whole protocol, so
 *    use them rather than fetching documentation". They did not carry it (they
 *    had been trimmed), and `edit` failed `used_edits_endpoint` for every agent
 *    that ran it, against four passes in copy-text where nothing said that.
 *  - an earlier "Fetch no docs" line sent pi hunting for `/api/openapi.json`
 *    and `/api/swagger.json`.
 *
 * Saying a sheet is USUALLY enough is fine and stays — it is the absolutism
 * that goes, and the pointer that must always be within reach.
 */
describe('no agent-facing surface forbids a look or claims to be complete', () => {
  const surfaces: Array<[string, string]> = [
    ...SURFACES,
    ['quick sheet', buildQuickSheet(BASE)],
  ];

  it.each(surfaces)('%s never forbids fetching or reading', (_name, text) => {
    expect(text).not.toMatch(/do not fetch|don't fetch|never fetch/i);
    expect(text).not.toMatch(/no need to (fetch|read|look)/i);
    expect(text).not.toMatch(/do not read|avoid reading/i);
  });

  it.each(surfaces)('%s never claims to carry everything', (_name, text) => {
    expect(text).not.toMatch(/carry the whole protocol|covers everything|everything you need is/i);
  });

  /** And the escape hatch has to be present, not merely un-forbidden. */
  it('the quick sheet names the full reference', () => {
    expect(buildQuickSheet(BASE)).toContain(`${BASE}/docs`);
  });
});
