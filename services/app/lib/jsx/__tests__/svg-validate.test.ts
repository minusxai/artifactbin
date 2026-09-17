/**
 * SVG subset in the markup tier — validator gate.
 *
 * Subject motifs (frame rulers, sparkline decorations, diagram fragments) need
 * inline SVG; the allowlist admits a minimal DRAWING subset only. Everything
 * active stays out: no <use>/<image> (external fetch), no <foreignObject>
 * (nested HTML context), no SMIL (<animate>), and paint attributes may only
 * reference LOCAL url(#…) targets — an external url() in fill/stroke/filter is
 * an exfiltration + capture-taint vector, same ban as banned-css.
 */
import { describe, it, expect } from 'vitest';
import { validateJsxSource } from '@/lib/jsx';
import { JSX_STORY_COMPONENT_NAMES } from '@/lib/jsx/components';
import { STORY_HTML_TAGS, STORY_SVG_TAGS } from '@/lib/story-ui/component-names';

const validate = (src: string) =>
  validateJsxSource(src, JSX_STORY_COMPONENT_NAMES, STORY_HTML_TAGS, 'no-inline-style');

const MOTIF = `<svg viewBox="0 0 540 60" className="w-full">
  <defs>
    <linearGradient id="g" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#e2483d" /></linearGradient>
    <clipPath id="c"><rect x="0" y="0" width="10" height="10" /></clipPath>
  </defs>
  <g className="text-primary">
    <path d="M0 30 L540 30" stroke="currentColor" strokeWidth="2" fill="none" />
    <circle cx="270" cy="30" r="6" fill="url(#g)" />
    <text x="0" y="54" className="font-mono text-xs" fill="currentColor">FRAME 0000</text>
  </g>
</svg>`;

describe('svg subset — allowed', () => {
  it('accepts a full drawing motif (camelCase tags, local paint refs)', () => {
    expect(validate(MOTIF)).toEqual([]);
  });

  it('every canonical svg tag is individually allowed', () => {
    for (const tag of STORY_SVG_TAGS) {
      const src = tag === 'svg' ? '<svg />' : `<svg><${tag} /></svg>`;
      expect(validate(src), tag).toEqual([]);
    }
  });
});

describe('svg subset — denied', () => {
  it.each([['use'], ['image'], ['foreignObject'], ['animate'], ['pattern'], ['mask'], ['marker'], ['symbol']])(
    'rejects <%s>',
    (tag) => {
      const errors = validate(`<svg><${tag} /></svg>`);
      expect(errors.length).toBeGreaterThan(0);
    },
  );

  it('rejects <script> inside svg (dangerous tag, not just unlisted)', () => {
    const errors = validate('<svg><script>alert(1)</script></svg>');
    expect(errors.some((e) => /Disallowed tag/.test(e.message))).toBe(true);
  });

  it('rejects event handlers on svg elements', () => {
    const errors = validate('<svg><path d="M0 0" onClick="x" /></svg>');
    expect(errors.some((e) => /Event handler/.test(e.message))).toBe(true);
  });

  it('rejects EXTERNAL url() in paint attributes; local #refs pass', () => {
    expect(validate('<svg><circle r="4" fill="url(#g)" /></svg>')).toEqual([]);
    for (const attr of ['fill', 'stroke', 'filter', 'mask', 'clip-path']) {
      const errors = validate(`<svg><circle r="4" ${attr}="url(https://evil.example/x)" /></svg>`);
      expect(errors.length, attr).toBeGreaterThan(0);
    }
  });

  it('rejects javascript: in an svg <a> href (existing URL gate covers svg)', () => {
    const errors = validate('<svg><a href="javascript:alert(1)"><text>x</text></a></svg>');
    expect(errors.some((e) => /URL scheme/.test(e.message))).toBe(true);
  });
});
