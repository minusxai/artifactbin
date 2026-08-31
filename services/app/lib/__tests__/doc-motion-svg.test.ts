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
const buildMarkupDoc = (base: string) => ['artifact-bin/references/markup.md', 'artifact-bin/references/markup-data.md', 'artifact-bin/references/markup-motion.md', 'artifact-bin/references/markup-svg.md', 'artifact-bin/references/markup-video.md'].map((p) => renderDoc(p, base)).join('\n');
const buildDesignDoc = (base: string) => renderDoc('artifact-bin/references/design.md', base);
const buildTemplatesDoc = (base: string) => renderDoc('artifact-bin/references/templates.md', base);
const buildTemplateDoc = (base: string, name: string) => renderDoc(`artifact-bin/references/templates-${name}.md`, base);
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

/**
 * The reference must teach the ONE capability unification added, or agents
 * conclude the opposite — and they did. An agent reading this doc reasoned:
 * "This platform can't take the original's hand-rolled JS — static JSX, no
 * event handlers", and rewrote a working interactive page as <Param>/<Question>
 * embeds. It was reading these very lines: "No … event handlers … no
 * `<script>`", written before a document could carry one, with no mention of
 * `<Helmet>` anywhere in the file.
 *
 * Both halves of the truth have to sit together: inline `onclick=` really is
 * rejected AND the document runs its own script, so handlers are ATTACHED from
 * it. Naming only the first reads as "no JavaScript here".
 */
describe('markup doc teaches that a document runs its own JavaScript', () => {
  const doc = buildMarkupDoc(BASE);

  it('names <Helmet> as the home for the document title, CSS and script', () => {
    expect(doc).toContain('<Helmet>');
    expect(doc).toContain('<script>');
  });

  it('never claims a document cannot carry a script', () => {
    expect(doc).not.toMatch(/no\s+`?<script>`?/i);
  });

  it('connects the ban on inline handlers to the way that DOES work', () => {
    expect(doc).toMatch(/addEventListener/);
  });

  it('sends custom CSS to the Helmet, not a body <style> block', () => {
    expect(doc).not.toMatch(/ONE top-level style block/i);
    expect(doc).toMatch(/<Helmet>[\s\S]{0,400}<style>/);
  });
});
