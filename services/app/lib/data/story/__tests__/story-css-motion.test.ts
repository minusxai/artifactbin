/**
 * The motion kit MUST survive the per-story Tailwind compile (candidate
 * extraction is not proof of emission — the grid suite's lesson). These pin:
 *
 *  - `animate-*` kit tokens emit their keyframes exactly when a document uses
 *    the utility (marquee, fade-up, …), never for documents that don't.
 *  - `.reveal-*` utilities emit the observer contract: hidden ONLY under
 *    `:root[data-mx-motion]` and `:not([data-mx-seen])`, and only when the
 *    viewer allows motion (prefers-reduced-motion guard).
 *  - The flourish vocabulary the skills document stays compilable: arbitrary
 *    animation/transition delays (stagger), arbitrary hex accents, hover
 *    micro-interactions. These already work today; the pins keep a future
 *    guard/refactor from silently banning them.
 */
import { compileStoryCss } from '../story-css.server';
import { STORY_REVEAL_CLASSES } from '../motion';

const doc = (classes: string) =>
  `<div class="mx-story" data-design="tw"><p class="${classes}">x</p></div>`;

const compile = (classes: string) => compileStoryCss(doc(classes), { force: true });

describe('story motion kit — animate-* tokens', () => {
  it('emits marquee keyframes and utility for a document using animate-marquee', async () => {
    const css = await compile('animate-marquee');
    expect(css).toContain('.animate-marquee');
    expect(css).toContain('@keyframes marquee');
    expect(css).toContain('translateX(-50%)');
  });

  it('emits entrance keyframes (fade-up) with a hidden from-state', async () => {
    const css = await compile('animate-fade-up');
    expect(css).toContain('.animate-fade-up');
    expect(css).toContain('@keyframes fade-up');
    expect(css).toMatch(/opacity:\s*0/);
  });

  it('emits the ambient float loop', async () => {
    const css = await compile('animate-float');
    expect(css).toContain('.animate-float');
    expect(css).toContain('@keyframes float');
  });

  it('emits NO kit keyframes for a document that uses none of them', async () => {
    const css = await compile('font-bold');
    expect(css).not.toContain('@keyframes marquee');
    expect(css).not.toContain('@keyframes fade-up');
    expect(css).not.toContain('@keyframes float');
  });

  it('neutralizes kit animations under prefers-reduced-motion', async () => {
    const css = await compile('animate-marquee');
    const reduced = css!.slice(css!.indexOf('prefers-reduced-motion'));
    expect(reduced).toContain('.animate-marquee');
    expect(reduced).toMatch(/animation:\s*none/);
  });
});

describe('story motion kit — reveal utilities (observer contract)', () => {
  it.each(STORY_REVEAL_CLASSES.map((c) => [c]))('emits the %s utility', async (cls) => {
    const css = await compile(cls);
    expect(css).toContain(`.${cls}`);
  });

  it('hides reveal elements ONLY under the motion flag, until seen', async () => {
    const css = await compile('reveal-up');
    expect(css).toContain('[data-mx-motion]');
    expect(css).toContain(':not([data-mx-seen])');
    // The hidden state must be motion-gated: no bare `.reveal-up { opacity: 0 }`
    // outside the [data-mx-motion] scope — captures and edit mode render visible.
    const hiddenRules = css!.split('{').filter((s) => /opacity:\s*0/.test(s.split('}')[0] ?? ''));
    expect(hiddenRules.length).toBeGreaterThan(0);
    expect(css).toContain('prefers-reduced-motion');
  });

  it('reveal-up moves as well as fades; reveal-scale scales', async () => {
    const up = await compile('reveal-up');
    expect(up).toMatch(/translate/i);
    const scale = await compile('reveal-scale');
    expect(scale).toMatch(/scale/i);
  });
});

describe('utility importance (Tailwind always beats authored CSS)', () => {
  it('jsx-tier utilities compile !important', async () => {
    const css = await compile('font-bold');
    const rule = css!.slice(css!.indexOf('.font-bold'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('!important');
  });

  it('legacy marked stories keep the non-important cascade (frozen behavior)', async () => {
    const css = await compileStoryCss('<div class="mx-story font-bold" data-design="tw">x</div>');
    const rule = css!.slice(css!.indexOf('.font-bold'));
    expect(rule.slice(0, rule.indexOf('}'))).not.toContain('!important');
  });
});

describe('flourish vocabulary stays compilable (pins)', () => {
  it('arbitrary animation/transition delays compile (stagger)', async () => {
    const css = await compile('[animation-delay:200ms] [transition-delay:150ms]');
    expect(css).toContain('animation-delay');
    expect(css).toContain('transition-delay');
  });

  it('arbitrary hex accents compile (bespoke identity)', async () => {
    const css = await compile('text-[#e2483d] bg-[#101014]');
    expect(css).toContain('#e2483d');
    expect(css).toContain('#101014');
  });

  it('hover micro-interactions compile', async () => {
    const css = await compile('hover:-translate-y-1 transition');
    expect(css).toContain(':hover');
  });
});
