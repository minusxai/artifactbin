/**
 * Every docs file LEADS with its critical content — the rule the old `/docs/llm` was reordered to
 * follow, kept for the tree so no file drifts back to configuration-before-vocabulary.
 *
 * WHAT THIS FILE NO LONGER DOES. It used to pin BYTE OFFSETS of prose — "the first link is within
 * 400 bytes", "inside the first 1,500 bytes", "the skeleton starts in the top half" — twelve cases
 * and two per-registry loops of them. Those break on any editorial edit and prove nothing about
 * behaviour: a file can satisfy every offset and still teach the wrong thing, and a file can fail
 * every offset while reading perfectly. What survives is the two claims that are structural rather
 * than positional (configuration comes after the skeleton; theme routing comes after the example)
 * and the CONTENT each page must carry, which is what an agent acts on.
 *
 * The generic half — every file opens with `## Read first`, bounded, within its byte budget —
 * lives in skill-tree.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { buildQuickSheet, renderDoc } from '../skills';
import { STORY_THEMES } from '../data/story/story-themes';

const BASE = 'https://example.test';

describe('the markup skill teaches vocabulary before configuration', () => {
  const doc = renderDoc('artifactbin/references/markup.md', BASE);
  it('carries the wrapper, the skeleton and both allowlists', () => {
    for (const needle of ['data-design="tw"', '## Skeleton', 'complete allowlist']) expect(doc).toContain(needle);
  });
  it('puts the Helmet/CSS/script configuration AFTER the skeleton', () => {
    expect(doc.indexOf('## `<Helmet>`')).toBeGreaterThan(doc.indexOf('## Skeleton'));
  });
});

describe('each theme file states its identity', () => {
  it.each(STORY_THEMES.map((theme) => [theme.name, theme] as const))('%s: description, fonts and default mode', (_name, theme) => {
    const doc = renderDoc(`artifactbin/references/themes-${theme.name}.md`, BASE);
    for (const needle of [theme.description, 'Fonts:', 'Default mode:']) expect(doc, needle).toContain(needle);
  });
});

describe('the design skill leads with the rules an agent can act on', () => {
  const doc = renderDoc('artifactbin/references/design.md', BASE);
  it('teaches the supported web-font route, and no longer sends agents to a data: URI blob or prefers-color-scheme', () => {
    expect(doc).toContain('name="font-display"');
    expect(doc).not.toContain('prefers-color-scheme');
    expect(doc).not.toMatch(/data:[^\n]*@font-face|@font-face[^\n]*data:/);
  });
});

describe('the brief — the one text every agent reads', () => {
  const sheet = buildQuickSheet(BASE);
  it('carries the data vocabulary a dashboard needs (sourced Query, bound by $name)', () => {
    for (const needle of ['<Query', 'source="./sales.csv"', 'ref:<id>', 'public.rows', 'data="$']) expect(sheet).toContain(needle);
  });
  it('does not forbid h-screen / vh — the platform rewrites both on every path', () => {
    expect(sheet).not.toMatch(/never vh/i);
  });
  it('keeps the hard rules with the example they govern, and routes theme and template AFTER both', () => {
    // The brief is: Read first (what an artifact is, the CLI loop), then ONE example that carries
    // the data block AND the document rules as comments beside the lines they govern, then the
    // reference list. That ORDER is the rule; how many bytes each part takes is editorial.
    const rules = sheet.indexOf('self-contained');
    const example = sheet.indexOf('```jsx');
    const data = sheet.indexOf('<Query');
    const bodyRules = sheet.indexOf('static JSX', example);
    const theme = sheet.indexOf('afbin help themes', sheet.indexOf('## Read next'));
    expect(rules).toBeGreaterThan(-1);
    expect(example).toBeGreaterThan(rules);
    // Nothing about themes or templates sits between the rules and the example.
    expect(sheet.slice(rules, example)).not.toMatch(/themes-|templates-|afbin help themes/);
    expect(sheet.indexOf('## Example')).toBeLessThan(example);
    expect(data).toBeGreaterThan(example);
    expect(bodyRules).toBeGreaterThan(data);
    expect(theme).toBeGreaterThan(bodyRules);
  });
});
