/**
 * The authoring docs must TEACH the flourish vocabulary the engine now ships —
 * an agent only reaches for what the reference names. These pin the load-bearing
 * additions: the motion kit (marquee + reveals and their fail-open contract),
 * the inline-SVG motif subset, the bespoke-accent allowance, and the demotion
 * of templates from mandatory beat-sheets to genre references.
 */
import { describe, it, expect } from 'vitest';
import { renderDoc } from '../skills';

const B = 'https://example.test';
/** The markup skill as one text: its SKILL.md plus the motion, svg and data files it links. */
const buildMarkupDoc = (base: string) => ['artifactbin/references/markup.md', 'artifactbin/references/markup-data.md', 'artifactbin/references/markup-motion.md', 'artifactbin/references/markup-svg.md', 'artifactbin/references/markup-video.md'].map((p) => renderDoc(p, base)).join('\n');
const buildDesignDoc = (base: string) => renderDoc('artifactbin/references/design.md', base);
const buildTemplatesDoc = (base: string) => renderDoc('artifactbin/references/templates.md', base);
const buildTemplateDoc = (base: string, name: string) => renderDoc(`artifactbin/references/templates-${name}.md`, base);
void B;

const BASE = 'https://example.test';

describe('markup doc teaches the motion kit', () => {
  const doc = buildMarkupDoc(BASE);

  it('documents the animate-* tokens and the marquee duplicate-content pattern', () => {
    expect(doc).toContain('animate-marquee');
    expect(doc).toContain('animate-fade-up');
    expect(doc).toMatch(/twice|duplicate/i);
  });

  it('documents scroll reveals with stagger and the fail-open contract', () => {
    expect(doc).toContain('reveal-up');
    expect(doc).toContain('[transition-delay:');
    expect(doc).toMatch(/captures|edit mode/i);
    expect(doc).toMatch(/reduced[- ]motion/i);
  });

  it('documents the svg motif subset and the local-paint rule', () => {
    expect(doc).toContain('<svg');
    expect(doc).toContain('clipPath');
    expect(doc).toContain('url(#');
  });

  it('allows a bespoke accent while keeping tokens the default', () => {
    expect(doc).toMatch(/text-\[#/);
  });

  it('teaches the authored <style> block: template-literal idiom, custom keyframes, inline ban', () => {
    expect(doc).toContain('<style>{`');
    expect(doc).toContain('@keyframes');
    expect(doc).toMatch(/style=.*(rejected|not allowed)|inline `?style`?[^.]*(rejected|stays out)/i);
  });

  it('states the cascade contract: utilities are !important and always win', () => {
    expect(doc).toContain('!important');
  });

  it('documents the custom-reveal contract (data-reveal + data-mx-seen)', () => {
    expect(doc).toContain('data-reveal');
    expect(doc).toContain('data-mx-seen');
    expect(doc).toContain('data-mx-motion');
  });
});

describe('design doc teaches motion and the subject motif', () => {
  const doc = buildDesignDoc(BASE);

  it('carries a motion section preferring one orchestrated moment', () => {
    expect(doc).toMatch(/## Motion/i);
    expect(doc).toMatch(/orchestrated/i);
  });

  it('promotes the subject motif / conceit beyond scrolly', () => {
    expect(doc).toMatch(/motif/i);
    expect(doc).toMatch(/deadpan|any register/i);
  });
});

describe('templates are genre references, not contracts', () => {
  it('the index says deviating / omitting the template is legitimate', () => {
    const doc = buildTemplatesDoc(BASE);
    expect(doc).toMatch(/reference|starting point/i);
    expect(doc).toMatch(/omit|without a template|bespoke/i);
  });

  it('scrolly is the default when the ask does not name a genre; truly torn → ask the user', () => {
    for (const doc of [buildTemplatesDoc(BASE), buildMarkupDoc(BASE)]) {
      expect(doc).toMatch(/default to `?scrolly`?/i);
      expect(doc).toMatch(/ask (the )?user|clarify with (the )?user/i);
    }
  });

  it('scrolly documents the REAL marquee ticker, not "motion is optional"', () => {
    const doc = buildTemplateDoc(BASE, 'scrolly')!;
    expect(doc).toContain('animate-marquee');
    expect(doc).not.toMatch(/motion is optional and limited/);
  });
});

/*
 * That the markup reference teaches <Helmet> as the home of title, CSS and script,
 * never claims a document cannot carry a script, connects the inline-handler ban to
 * addEventListener, and never points at a body <style> block, is
 * agent-docs-current.test.ts's subject — it runs each of those over every
 * agent-facing surface at once (it.each(SURFACES)), not the markup doc alone.
 */
