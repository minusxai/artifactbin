import { describe, it, expect } from 'vitest';
import { remapViewportHeightUnits, STORY_VH_FALLBACK } from '../viewport-units';

const VH = `var(--mx-vh,${STORY_VH_FALLBACK})`;

describe('remapViewportHeightUnits — what it rewrites', () => {
  it('rewrites the exact case that shipped blank: h-screen', () => {
    // Tailwind v4's actual output for `h-screen`. This is the whole bug.
    expect(remapViewportHeightUnits('.h-screen{height:100vh}')).toBe(`.h-screen{height:${VH}}`);
  });

  it('maps 100vh to the bare var, with no needless calc', () => {
    expect(remapViewportHeightUnits('a{height:100vh}')).toBe(`a{height:${VH}}`);
  });

  it('scales any other length through calc', () => {
    expect(remapViewportHeightUnits('a{height:50vh}')).toBe(`a{height:calc(${VH}*50/100)}`);
  });

  it('handles decimals and negatives', () => {
    expect(remapViewportHeightUnits('a{height:12.5vh}')).toBe(`a{height:calc(${VH}*12.5/100)}`);
    expect(remapViewportHeightUnits('a{margin-top:-50vh}')).toBe(`a{margin-top:calc(${VH}*-50/100)}`);
  });

  it('covers the whole vertical family (Tailwind v4 emits dvh/svh/lvh)', () => {
    expect(remapViewportHeightUnits('a{height:100dvh}')).toBe(`a{height:${VH}}`);
    expect(remapViewportHeightUnits('a{height:100svh}')).toBe(`a{height:${VH}}`);
    expect(remapViewportHeightUnits('a{height:100lvh}')).toBe(`a{height:${VH}}`);
  });

  it('is case-insensitive on the unit', () => {
    expect(remapViewportHeightUnits('a{height:100VH}')).toBe(`a{height:${VH}}`);
  });

  it('nests inside an authored calc', () => {
    expect(remapViewportHeightUnits('a{height:calc(100vh - 4rem)}')).toBe(`a{height:calc(${VH} - 4rem)}`);
  });

  it('rewrites every declaration in a block, and every viewport length in one value', () => {
    expect(remapViewportHeightUnits('a{height:100vh;min-height:50vh}')).toBe(
      `a{height:${VH};min-height:calc(${VH}*50/100)}`,
    );
    expect(remapViewportHeightUnits('a{padding:10vh 2rem 20vh}')).toBe(
      `a{padding:calc(${VH}*10/100) 2rem calc(${VH}*20/100)}`,
    );
  });

  it('rewrites declarations nested inside an at-rule block', () => {
    expect(remapViewportHeightUnits('@media (min-width:40rem){.a{height:100vh}}')).toBe(
      `@media (min-width:40rem){.a{height:${VH}}}`,
    );
  });

  it('rewrites the last declaration in a block even without a trailing semicolon', () => {
    expect(remapViewportHeightUnits('a{color:red;height:100vh}')).toBe(`a{color:red;height:${VH}}`);
  });
});

describe('remapViewportHeightUnits — what it must NOT touch', () => {
  it('leaves the escaped arbitrary-value SELECTOR intact', () => {
    // Rewriting the selector breaks the class match and silently unstyles the
    // document — the failure would look like "the fix did nothing".
    const css = String.raw`.h-\[100vh\]{height:100vh}`;
    expect(remapViewportHeightUnits(css)).toBe(String.raw`.h-\[100vh\]{height:` + VH + '}');
  });

  it('leaves a Tailwind VARIANT selector intact (it carries a colon before the unit)', () => {
    // `\:` inside the selector is what breaks a naive "after the first colon is
    // a value" scanner — it would rewrite the selector text itself.
    const css = String.raw`.md\:h-\[100vh\]:hover{height:100vh}`;
    expect(remapViewportHeightUnits(css)).toBe(String.raw`.md\:h-\[100vh\]:hover{height:` + VH + '}');
  });

  it('leaves an at-rule PRELUDE intact (var() is invalid in a media query)', () => {
    const css = '@media (min-height:100vh){.a{color:red}}';
    expect(remapViewportHeightUnits(css)).toBe(css);
  });

  it('leaves viewport-WIDTH units alone — the iframe is already the container width', () => {
    const css = 'a{width:100vw;height:50vmin;max-width:80vmax}';
    expect(remapViewportHeightUnits(css)).toBe(css);
  });

  it('does not match a vh-looking substring inside an identifier', () => {
    const css = 'a{height:var(--slide-100vh)}';
    expect(remapViewportHeightUnits(css)).toBe(css);
  });

  it('leaves string literals alone', () => {
    const css = 'a::after{content:"100vh"}';
    expect(remapViewportHeightUnits(css)).toBe(css);
  });

  it('does not let braces inside a string break block tracking', () => {
    // A `{` in a string would desync a brace-counting scanner and make it treat
    // the following declarations as selector text (silently skipping them).
    const css = 'a::after{content:"{"}b{height:100vh}';
    expect(remapViewportHeightUnits(css)).toBe(`a::after{content:"{"}b{height:${VH}}`);
  });

  it('does not let braces inside a comment break block tracking', () => {
    const css = '/* } */ a{height:100vh}';
    expect(remapViewportHeightUnits(css)).toBe(`/* } */ a{height:${VH}}`);
  });
});

describe('remapViewportHeightUnits — robustness', () => {
  it('is idempotent (a re-injection must not compound)', () => {
    const once = remapViewportHeightUnits('a{height:100vh;min-height:50vh}');
    expect(remapViewportHeightUnits(once)).toBe(once);
  });

  it('passes through CSS with no viewport-height units byte for byte', () => {
    const css = '.a{color:red;padding:1rem}@media print{.b{display:none}}';
    expect(remapViewportHeightUnits(css)).toBe(css);
  });

  it('handles empty and degenerate input without throwing', () => {
    expect(remapViewportHeightUnits('')).toBe('');
    expect(remapViewportHeightUnits('a{')).toBe('a{');
    expect(remapViewportHeightUnits('}')).toBe('}');
  });

  it('survives a realistic compiled sheet: the deck that shipped blank', () => {
    const sheet = [
      '/*! tailwindcss v4.2.1 | MIT License */',
      '.min-h-screen{min-height:100vh}',
      '.h-screen{height:100vh}',
      String.raw`.min-h-\[80vh\]{min-height:80vh}`,
      '.w-full{width:100%}',
      '@media (min-width:64rem){.lg\\:h-screen{height:100vh}}',
    ].join('\n');
    const out = remapViewportHeightUnits(sheet);
    // Every DECLARATION is remapped...
    expect(out).toContain(`.min-h-screen{min-height:${VH}}`);
    expect(out).toContain(`.h-screen{height:${VH}}`);
    expect(out).toContain(`.lg\\:h-screen{height:${VH}}`);
    expect(out).toContain(String.raw`.min-h-\[80vh\]{min-height:calc(` + VH + '*80/100)}');
    // ...and no raw viewport-height length survives outside a selector.
    expect(out.replace(/\\\[[^\]]*\\\]/g, '')).not.toMatch(/\d(?:vh|dvh|svh|lvh)\b/i);
  });
});
