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
import { buildQuickSheet, renderDoc, renderSkill, skillTree } from '../skills';

const BASE = 'https://example.test';

describe('report requests have an explicit page-type default', () => {
  it('routes a report to editorial while distinguishing live monitoring and slides', () => {
    const guide = renderDoc('artifactbin/references/templates.md', BASE);
    expect(guide).toContain('“Make a report” selects `template: editorial` by default');
    expect(guide).toContain('report select `dashboard`');
    expect(guide).toContain('report presented as slides selects `deck`');
    expect(renderDoc('artifactbin/references/templates-editorial.md', BASE))
      .toContain('Reports, articles, briefings and long reads use `template: editorial`');
  });
});

describe('the markup skill teaches vocabulary before configuration', () => {
  const doc = renderDoc('artifactbin/references/markup.md', BASE);
  const components = renderDoc('artifactbin/references/markup-components.md', BASE);
  it('carries the wrapper, the skeleton and both allowlists', () => {
    for (const needle of ['data-design="tw"', '## Skeleton', 'complete allowlist']) expect(doc).toContain(needle);
  });
  it('puts the Helmet/CSS/script configuration AFTER the skeleton', () => {
    expect(doc.indexOf('## `<Helmet>`')).toBeGreaterThan(doc.indexOf('## Skeleton'));
  });
  it('makes the reusable Accordion FAQ example discoverable from markup.md', () => {
    expect(doc).toContain('[Accordion FAQ](markup-components.md).');
    expect(components).toContain('<Accordion type="single" collapsible>');
    expect(components).toContain('<AccordionItem value="shipping">');
    expect(components).toContain('<AccordionTrigger>How long does shipping take?</AccordionTrigger>');
    expect(components).toContain('<AccordionContent>Orders arrive in three to five business days.</AccordionContent>');
  });
  it('states the existing Helmet script child contract', () => {
    expect(doc).toContain('exactly one template-literal child');
    expect(doc).toContain('``<script>{`…`}</script>``');
  });
});

describe('the design skill leads with the rules an agent can act on', () => {
  const doc = renderDoc('artifactbin/references/design.md', BASE);
  it('keeps plain-language and paragraph guidance in condensed page-type help', () => {
    const file = skillTree().get('artifactbin/references/design.md')!;
    const bundled = renderSkill(file, { base: BASE, bundle: true });
    for (const text of [doc, bundled]) {
      expect(text).toContain('## Copy is design material');
      expect(text).toContain('Avoid text blobs');
      expect(text).toContain('ASD-STE100-inspired');
      expect(text).toContain('[copy guidance](copy.md)');
    }
    expect(buildQuickSheet(BASE)).toContain('references/copy.md');
  });
  it('teaches the supported web-font route, and no longer sends agents to a data: URI blob or prefers-color-scheme', () => {
    expect(doc).toContain('name="font-display"');
    expect(doc).not.toContain('prefers-color-scheme');
    expect(doc).not.toMatch(/data:[^\n]*@font-face|@font-face[^\n]*data:/);
  });
});

describe('the brief — the one text every agent reads', () => {
  const sheet = buildQuickSheet(BASE);
  it('carries the data vocabulary a dashboard needs (an Import, a Query over it, bound by $name)', () => {
    for (const needle of ['<Import name="sales" src="ref:abc123" />', '<Query', 'sales.rows', 'data="$']) expect(sheet).toContain(needle);
    for (const retired of ['source="ref:abc123"', 'public.rows']) expect(sheet).not.toContain(retired);
  });
  it('does not forbid h-screen / vh — the platform rewrites both on every path', () => {
    expect(sheet).not.toMatch(/never vh/i);
  });
  it('keeps the hard rules with the example they govern, and routes the page type and the design system AFTER both', () => {
    // The brief is: Read first (what an artifact is, the CLI loop), then ONE example that carries
    // the data block AND the document rules as comments beside the lines they govern, then the
    // reference list. That ORDER is the rule; how many bytes each part takes is editorial.
    const rules = sheet.indexOf('self-contained');
    const example = sheet.indexOf('```jsx');
    const data = sheet.indexOf('<Query');
    const bodyRules = sheet.indexOf('static JSX', example);
    const theme = sheet.indexOf('afbin help design-systems', sheet.indexOf('## Read next'));
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


it('keeps scrolly full-bleed bands inside the document while prose owns its padding', () => {
  const doc = renderDoc('artifactbin/references/templates-scrolly.md', BASE);
  expect(doc).toContain('unpadded siblings of padded prose sections');
  expect(doc).toContain('Do not widen the document with negative margins');
  expect(doc).toContain('className="@container text-foreground"');
  expect(doc).toContain('className="mx-auto max-w-6xl px-6 py-16 @2xl:px-12"');
  expect(doc).not.toContain('may run full-bleed (`-mx-6');
});
