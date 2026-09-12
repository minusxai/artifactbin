/**
 * The docs are ONE skill (`skills/artifactbin/`): `SKILL.md` — the brief with
 * a dispatch table — over `references/*.md`, the topic files, flat. The layout
 * is the Agent Skills convention Claude itself generates (a `references/`
 * subfolder, loaded on demand), so one preloaded description triggers the
 * whole surface instead of six.
 *
 * ONE generic guard walks it — every rule is data-driven (`validateSkillTree`
 * answers problems), so a new file joins the set by existing and a broken one
 * is named with its rule. First against literal trees, so each rule is seen
 * to fire; then against the real `skills/`, rendered with a fixed base so a
 * hostname cannot move a byte count.
 */
import { describe, it, expect } from 'vitest';
import {
  buildQuickSheet, buildSkillTree, expectedSkillName, readFirstBlock, renderSkill,
  mentionResolves, renderTree, resolveSkillLink, skillFileMentions, skillLinks, skillTree, validateSkillTree, QUICK_SHEET_MAX_BYTES,
  SKILL_FILE_MAX_BYTES, SKILL_LISTING_MAX_BYTES,
} from '../skills';
import { STORY_THEMES } from '../data/story/story-themes';
import { STORY_TEMPLATES } from '../data/story/story-templates';

const BASE = 'https://example.test';
const fm = (name: string, description = 'Third-person description of when to read this.') => `---\nname: ${name}\ndescription: ${description}\n---\n`;
const ok = (name: string, body = '## Read first\n\nA line.\n') => `${fm(name)}${body}`;
/** Sizes are measured against the PRODUCTION base — the longest a real deployment renders with. */
const SIZE_BASE = 'https://artifactbin.dev';
const render = (f: Parameters<typeof renderSkill>[0]) => renderSkill(f, { base: SIZE_BASE });

describe('the rules, each seen to fire on a literal tree', () => {
  it('a directory is a skill: it must hold a SKILL.md, and the root skill must exist', () => {
    const tree = buildSkillTree({ 'markup/references/data.md': ok('data') });
    const problems = validateSkillTree(tree, render);
    expect(problems).toContainEqual(expect.stringContaining('markup/: no SKILL.md'));
    expect(problems).toContainEqual(expect.stringContaining('no artifactbin/SKILL.md'));
  });
  it('names follow the file: SKILL.md → the directory, a reference → its basename', () => {
    expect(expectedSkillName({ dir: 'artifactbin', file: 'SKILL.md', ref: false })).toBe('artifactbin');
    expect(expectedSkillName({ dir: 'artifactbin', file: 'markup-data.md', ref: true })).toBe('markup-data');
    const tree = buildSkillTree({ 'artifactbin/SKILL.md': ok('artifactbin'), 'artifactbin/references/markup-data.md': ok('data') });
    expect(validateSkillTree(tree, render)).toContainEqual(expect.stringContaining('artifactbin/references/markup-data.md: name must be "markup-data"'));
  });
  it('a skill file is SKILL.md or references/<file>.md — nothing else, nothing deeper', () => {
    expect(() => buildSkillTree({ 'artifactbin/data.md': ok('data') })).toThrow(/SKILL\.md or references/);
    expect(() => buildSkillTree({ 'artifactbin/references/deep/x.md': ok('x') })).toThrow(/SKILL\.md or references/);
  });
  it('frontmatter: description required, ≤ 1,024 chars, third person; name [a-z0-9-] without "claude"', () => {
    const tree = buildSkillTree({
      'artifactbin/SKILL.md': `---\nname: artifactbin\ndescription: You can read this.\n---\n## Read first\n`,
      'claude-tips/SKILL.md': `---\nname: claude-tips\ndescription: ${'x'.repeat(1025)}\n---\n## Read first\n`,
      'markup/SKILL.md': `---\nname: markup\n---\n## Read first\n`,
    });
    const problems = validateSkillTree(tree, render);
    expect(problems).toContainEqual(expect.stringContaining('artifactbin/SKILL.md: description must be third person'));
    expect(problems).toContainEqual(expect.stringContaining('claude-tips/SKILL.md: name may not contain'));
    expect(problems).toContainEqual(expect.stringContaining('claude-tips/SKILL.md: description over 1,024'));
    expect(problems).toContainEqual(expect.stringContaining('markup/SKILL.md: description is required'));
  });
  it('the body opens with "## Read first", and that block is bounded', () => {
    const tree = buildSkillTree({
      'artifactbin/SKILL.md': ok('artifactbin', '## Intro\n\ntext\n'),
      'artifactbin/references/markup.md': ok('markup', `## Read first\n\n${'x'.repeat(2600)}\n\n## Next\n`),
    });
    const problems = validateSkillTree(tree, render);
    expect(problems).toContainEqual(expect.stringContaining('artifactbin/SKILL.md: the first heading must be "## Read first"'));
    expect(problems).toContainEqual(expect.stringMatching(/artifactbin\/references\/markup.md: the Read first block is 260\d B, cap 2500/));
    expect(readFirstBlock('## Read first\n\nA\n\n## B\n\nC')).toBe('\n\nA\n\n');
  });
  /**
   * A file NAMED in prose is a link an agent will follow by hand, and the tree
   * writes most of them that way: the dispatch table is `publishing.md`, the
   * reading path is `references/design.md`. `skillLinks` strips code spans
   * before it looks, so none of those were checked — and five stale six-skill
   * era names survived the port (`datasets.md`, `motion.md`, `data.md`, each
   * naming a file that had been renamed). A pattern (`themes-<name>.md`) is
   * satisfied by any file matching it, since the placeholder stands for the
   * registry's names.
   */
  it('a file named in prose must exist, patterns included', () => {
    const files = {
      'artifactbin/SKILL.md': ok('artifactbin', '## Read first\n\nRead `markup.md`, then `themes-<name>.md`. Uploading rows is `datasets.md`.\n'),
      'artifactbin/references/markup.md': ok('markup', '## Read first\n\nSee `references/themes-pop.md` and `nowhere.md`.\n'),
      'artifactbin/references/themes-pop.md': ok('themes-pop'),
    };
    const problems = validateSkillTree(buildSkillTree(files), render);
    expect(problems).toContainEqual(expect.stringContaining('SKILL.md: "datasets.md" names no file in the tree'));
    expect(problems).toContainEqual(expect.stringContaining('markup.md: "nowhere.md" names no file in the tree'));
    expect(problems).not.toContainEqual(expect.stringContaining('"markup.md" names no file'));
    expect(problems).not.toContainEqual(expect.stringContaining('"themes-<name>.md" names no file'));
    expect(problems).not.toContainEqual(expect.stringContaining('"references/themes-pop.md" names no file'));
    expect(skillFileMentions('read `a.md` and ```\n`b.md`\n``` and c.md')).toEqual(['a.md']);
  });
  it('a pattern that matches nothing is a problem, and a wrong directory does not save a name', () => {
    const files = {
      'artifactbin/SKILL.md': ok('artifactbin', '## Read first\n\nPick a `layouts-<name>.md`, see `references/gone.md`, and `themes-<name>.md`.\n'),
      'artifactbin/references/themes-pop.md': ok('themes-pop'),
    };
    const problems = validateSkillTree(buildSkillTree(files), render);
    expect(problems).toContainEqual(expect.stringContaining('"layouts-<name>.md" names no file in the tree'));
    expect(problems).toContainEqual(expect.stringContaining('"references/gone.md" names no file in the tree'));
    expect(problems).not.toContainEqual(expect.stringContaining('"themes-<name>.md"'));
    // The placeholder stands for a NAME, so it never matches the empty string.
    expect(mentionResolves(buildSkillTree({ 'artifactbin/SKILL.md': ok('artifactbin'), 'artifactbin/references/themes-.md': ok('themes-') }), 'themes-<name>.md')).toBe(false);
    // A backslash cannot reach the matcher, and would not be a metacharacter if it did.
    expect(mentionResolves(buildSkillTree({ 'artifactbin/SKILL.md': ok('artifactbin') }), 'a\\d.md')).toBe(false);
  });
  it('links resolve one level deep: SKILL.md → its references, a reference → a sibling or its SKILL.md', () => {
    const tree = buildSkillTree({
      'artifactbin/SKILL.md': ok('artifactbin', '## Read first\n\n[a](references/markup.md) [b](references/nowhere.md) [c](../../etc)\n'),
      'artifactbin/references/markup.md': ok('markup', '## Read first\n\n[data](markup-data.md) [up](../SKILL.md), the api at /docs/artifactbin/SKILL.md, and [[ base ]]/docs/artifactbin/SKILL.md is fine\n'),
      'artifactbin/references/markup-data.md': ok('markup-data'),
    });
    const problems = validateSkillTree(tree, render);
    expect(problems).toContainEqual(expect.stringContaining('link "references/nowhere.md" → artifactbin/references/nowhere.md does not exist'));
    expect(problems).toContainEqual(expect.stringContaining('link "../../etc" leaves the tree'));
    expect(problems).toContainEqual(expect.stringContaining('references/markup.md: a docs address is [[ base ]]/docs/'));
    expect(problems.filter((p) => p.includes('markup.md: a docs address'))).toHaveLength(1);
    expect(problems).not.toContainEqual(expect.stringContaining('"references/markup.md"'));
    expect(problems).not.toContainEqual(expect.stringContaining('"markup-data.md"'));
    expect(problems).not.toContainEqual(expect.stringContaining('"../SKILL.md"'));
    expect(skillLinks('see [x](a.md) and `[y](b.md)` and ```\n[z](c.md)\n```')).toEqual(['a.md']);
    expect(resolveSkillLink({ path: 'artifactbin/references/markup.md' } as never, 'markup-data.md')).toBe('artifactbin/references/markup-data.md');
    expect(resolveSkillLink({ path: 'artifactbin/references/markup.md' } as never, '../SKILL.md')).toBe('artifactbin/SKILL.md');
    expect(resolveSkillLink({ path: 'artifactbin/SKILL.md' } as never, 'references/markup.md')).toBe('artifactbin/references/markup.md');
  });
  it('the old delimiter is refused by name — "{{ base" would render literally', () => {
    const tree = buildSkillTree({ 'artifactbin/SKILL.md': ok('artifactbin', '## Read first\n\n{{ base }}/api\n') });
    expect(validateSkillTree(tree, render)).toContainEqual(expect.stringContaining('"{{ base" is the old delimiter'));
  });
  it('a typo in a variable is a render failure, never an empty string', () => {
    const tree = buildSkillTree({ 'artifactbin/SKILL.md': ok('artifactbin', '## Read first\n\n[[ basee ]]/api\n') });
    expect(() => render(tree.files[0])).toThrow(/artifactbin\/SKILL.md/);
  });
  it('size: ≤ 8,192 B and ≤ 500 lines rendered; over 100 lines needs a Contents; the listing is capped', () => {
    const tree = buildSkillTree({
      'artifactbin/SKILL.md': ok('artifactbin', `## Read first\n\n${'y'.repeat(9000)}\n`),
      'artifactbin/references/markup.md': ok('markup', `## Read first\n${'line\n'.repeat(120)}## A\n## B\n`),
    });
    const problems = validateSkillTree(tree, render, SKILL_LISTING_MAX_BYTES + 1);
    expect(problems).toContainEqual(expect.stringMatching(/artifactbin\/SKILL.md: 90\d\d B rendered, cap 8192/));
    expect(problems).toContainEqual(expect.stringContaining('artifactbin/references/markup.md: 124 lines and 3 sections without a "## Contents"'));
    expect(problems).toContainEqual(expect.stringContaining(`the /docs listing is ${SKILL_LISTING_MAX_BYTES + 1} B`));
  });
  it('the registries are globals: counts and names come from the code', () => {
    const tree = buildSkillTree({ 'artifactbin/SKILL.md': ok('artifactbin', '## Read first\n\n[[ tags | length ]] tags, [[ components | length ]] components, [% for t in themes %][[ t.name ]] [% endfor %]\n') });
    const text = render(tree.files[0]);
    expect(text).toMatch(/\d{2,3} tags, \d{2} components, modernist organic industry terminal manuscript pop/);
  });
  it('a theme or template reference sees its own registry entry', () => {
    const tree = buildSkillTree({
      'artifactbin/SKILL.md': ok('artifactbin'),
      'artifactbin/references/themes-industry.md': ok('themes-industry', '## Read first\n\n[[ theme.label ]] / [[ theme.fonts ]] / [[ theme.defaultMode ]]\n'),
      'artifactbin/references/templates-deck.md': ok('templates-deck', '## Read first\n\n[[ template.beats | join(" → ") ]]\n'),
    });
    expect(render(tree.get('artifactbin/references/themes-industry.md')!)).toContain('Industry / display Inter, body Inter, mono JetBrains Mono / light');
    expect(render(tree.get('artifactbin/references/templates-deck.md')!)).toMatch(/Cover → /);
  });
});

describe('the real tree (skills/) obeys every rule', () => {
  const tree = skillTree();
  /**
   * THE byte-cap sweep. It used to be asserted in seven places — the brief, the auth rule, the
   * folder guidance, the publish-first rule, the quick sheet, the measured-fixes template docs and
   * here — each over one file, one of them with 8192 hard-coded instead of the constant. One walk
   * over the rendered tree covers every one of them, and covers a file added tomorrow too.
   */
  it('keeps every rendered file — the brief and every reference — within its reading budget',()=>{
    for(const file of tree.files)expect(Buffer.byteLength(render(file)),file.path).toBeLessThanOrEqual(SKILL_FILE_MAX_BYTES);
    expect(tree.files.length).toBeGreaterThan(10);
    expect(tree.files.some(file=>!file.ref),'the brief itself must be in the sweep').toBe(true);
  });
  it('is ONE skill — the brief over its references, nothing else preloaded', () => {
    expect(tree.dirs.map((d) => d.name)).toEqual(['artifactbin']);
    expect(tree.files.filter((f) => !f.ref)).toHaveLength(1);
  });
  it('carries one reference per theme and per template, named after the registry', () => {
    for (const t of STORY_THEMES) expect(tree.get(`artifactbin/references/themes-${t.name}.md`)?.name).toBe(`themes-${t.name}`);
    for (const t of STORY_TEMPLATES) expect(tree.get(`artifactbin/references/templates-${t.name}.md`)?.name).toBe(`templates-${t.name}`);
  });
  it('uses the CLI-owned root within its budget',()=>{
    const sheet=buildQuickSheet(BASE);expect(Buffer.byteLength(sheet)).toBeLessThanOrEqual(QUICK_SHEET_MAX_BYTES);expect(sheet).toContain('afbin push');
  });
  it('renders every file for two bases with no leftover template syntax', () => {
    for (const base of [BASE, 'http://localhost:3000']) {
      for (const { file, text } of renderTree(tree, base)) {
        expect(text, file.path).not.toMatch(/\[\[|\]\]|\[%|%\]/);
        expect(text, file.path).not.toContain('{{ base');
      }
    }
  });
});

/**
 * One owner per topic — the audit measured that the duplication between the
 * old pages was SEMANTIC (one rule reworded on four pages, three of them
 * wrong), so a fingerprint phrase per topic lives in exactly one file.
 */
describe('each topic is taught by exactly its owner', () => {
  const rendered = Object.fromEntries(renderTree(skillTree(), BASE).map(({ file, text }) => [file.path, text]));
  const owners = (needle: string | RegExp) => Object.keys(rendered).filter((p) => (typeof needle === 'string' ? rendered[p].includes(needle) : needle.test(rendered[p])));
  const R = 'artifactbin/references';
  const cases: Array<[string, string | RegExp, string[]]> = [
    ['the generic <Mutation> grammar', '<Mutation name source="ref:abc123">{`insert', [`${R}/markup-data.md`]],
    ['the Helmet cardinality rule', /at most ONE per document/i, [`${R}/markup.md`]],
    ['editable table grammar and seven-editor example', '<DataTable data="$roadmap" rowKey="id">', [`${R}/markup-editing.md`]],
    ['the reader-control roster', '## Bindings: controls', [`${R}/markup-data.md`]],
    ['the <Helmet> :root override example', /:root \{ --background/, [`${R}/markup.md`]],
    ['the scroll-reveal observer', 'data-mx-seen', [`${R}/markup-motion.md`]],
    ['the video card', '<Video src=', [`${R}/markup-video.md`]],
    ['the SVG subset', 'foreignObject', [`${R}/markup-svg.md`]],
  ];
  for (const [topic, fp, owner] of cases) {
    it(`${topic} → ${owner.join('+')}`, () => {
      expect(owners(fp)).toEqual(owner);
    });
  }
  it('a theme one-liner lives on the themes index and its own page, nowhere else', () => {
    for (const t of STORY_THEMES) expect(owners(t.description).sort(), t.name).toEqual([`${R}/themes-${t.name}.md`, `${R}/themes.md`]);
  });
  it('a template one-liner lives on the templates index and its own page, nowhere else', () => {
    for (const t of STORY_TEMPLATES) expect(owners(t.description).sort(), t.name).toEqual([`${R}/templates-${t.name}.md`, `${R}/templates.md`]);
  });
});
