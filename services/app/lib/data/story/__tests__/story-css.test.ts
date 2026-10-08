/**
 * Story design-system CSS — contract tests.
 *
 * A story gets exactly the Tailwind utilities it uses compiled to a per-story stylesheet.
 */
import { extractClassCandidates } from '../story-css';
import { compileStoryCss } from '../story-css.server';
import { STORY_THEMES } from '../story-themes';

const TW_STORY =
  '<div class="mx-story" data-design="tw">' +
  '<h1 class="text-3xl font-bold text-slate-900">Title</h1>' +
  '<div class="grid grid-cols-3 gap-4">' +
  '<span class="mt-2.5 rounded-full bg-red-100 px-2.5 text-[13px] dark:bg-red-950">pill</span>' +
  '</div></div>';

describe('extractClassCandidates', () => {
  it('collects every class token, deduped and sorted (deterministic)', () => {
    const c = extractClassCandidates('<div class="b a"><span class="a c">x</span></div>');
    expect(c).toEqual(['a', 'b', 'c']);
  });
  it('keeps arbitrary-value utilities intact and handles single quotes', () => {
    const c = extractClassCandidates("<span class='text-[13px] w-[calc(100%-2rem)]'>x</span>");
    expect(c).toContain('text-[13px]');
    expect(c).toContain('w-[calc(100%-2rem)]');
  });
  it('ignores non-class attributes and text content', () => {
    const c = extractClassCandidates('<div data-x="flex" title="grid">bg-red-100</div>');
    expect(c).toEqual([]);
  });

  it('decodes entity-escaped arbitrary-variant classes (stored attrs escape &/>/<)', () => {
    // Component recipes like [&>p]:mt-3 are stored entity-escaped (escAttr) so tag scanners
    // don't break; extraction must decode them back to the real Tailwind candidates.
    const c = extractClassCandidates('<div class="[&amp;&gt;p]:mt-3 [&amp;_ul]:list-disc rounded-2xl">x</div>');
    expect(c).toContain('[&>p]:mt-3');
    expect(c).toContain('[&_ul]:list-disc');
    expect(c).toContain('rounded-2xl');
  });
});

describe('compileStoryCss', () => {
  it('returns null for empty input', async () => {
    expect(await compileStoryCss('')).toBeNull();
    expect(await compileStoryCss(null)).toBeNull();
    expect(await compileStoryCss(undefined)).toBeNull();
  });

  it('compiles exactly the used utilities for a marked story (incl. arbitrary values)', async () => {
    const css = await compileStoryCss(TW_STORY);
    expect(css).toBeTruthy();
    expect(css).toContain('.grid-cols-3');
    expect(css).toContain('.bg-red-100');
    expect(css).toContain('.text-\\[13px\\]');
    // Unused utilities are not emitted — this is a per-story build, not a full framework dump.
    expect(css).not.toContain('.bg-emerald-');
  });

  it('supports class-based dark mode (iframe html gets .dark, not prefers-color-scheme)', async () => {
    const css = await compileStoryCss(TW_STORY);
    expect(css).toMatch(/\.dark/); // dark:bg-red-950 must key off the .dark class
  });

  it('includes the preflight/base layer for marked stories', async () => {
    const css = (await compileStoryCss(TW_STORY))!;
    expect(css).toContain('box-sizing');
  });

  it('is deterministic for the same document', async () => {
    const a = await compileStoryCss(TW_STORY);
    const b = await compileStoryCss(TW_STORY);
    expect(a).toEqual(b);
  });

  // End-to-end for component recipes: emitted (entity-escaped) arbitrary-variant classes must
  // survive storage → extraction → compile and produce real descendant rules.
  it('compiles entity-escaped arbitrary-variant recipes (Takeaways/FigurePlate descendant styling)', async () => {
    const stored = '<div data-design="tw"><div class="[&amp;_ul]:list-disc [&amp;&gt;p]:mt-3">x</div></div>';
    const css = (await compileStoryCss(stored))!;
    expect(css).toContain('list-style-type: disc');
    expect(css).toMatch(/>\s*p/); // the child-combinator selector made it into the CSS
  });

  // The story iframe also carries the app's mirrored stylesheet (reset included) UN-layered,
  // and un-layered CSS beats @layer CSS regardless of order — so layered utilities silently
  // lose every property the reset touches (padding/margins/font-size: the "everything is
  // cramped" bug). The compiled output must be FLAT (no @layer wrappers/statements) so it
  // competes by document order, where it wins (injected after the mirror).
  it('emits flat CSS — no cascade layers to lose against the un-layered app mirror', async () => {
    const css = (await compileStoryCss(TW_STORY))!;
    expect(css).not.toContain('@layer');
    // The rules themselves survive the unwrapping, at top level.
    expect(css).toContain('.grid-cols-3');
    expect(css).toContain('.mt-2\\.5');
    expect(css).toMatch(/\.bg-red-100\s*\{/);
    // Nested at-rules (media/container/supports) survive inside the flattened output.
    expect(css).toContain('@property');
  });
});

// Hardening: a malformed class token must never fail the compile —
// bad candidates are bisected out and the survivors' CSS is returned. A build() that rejects a
// token like `w-[calc(100%` (unbalanced bracket) would otherwise throw all the way up and fail
// the whole save; the salvage guard itself is covered by the `buildSalvaging` block below.
describe('compileStoryCss hardening — malformed candidates never throw', () => {
  const BROKEN_STORY =
    '<div class="mx-story" data-design="tw">' +
    '<p class="bg-amber-100 w-[calc(100% text-slate-900">broken token amid good ones</p></div>';

  it('survives a malformed arbitrary-value token and still compiles the good utilities', async () => {
    const css = await compileStoryCss(BROKEN_STORY);
    expect(css).toBeTruthy();
    expect(css).toContain('.bg-amber-100');
    expect(css).toContain('.text-slate-900');
  });

  it('returns base-only CSS when every candidate is malformed (never throws, never null for marked stories)', async () => {
    const allBad = '<div data-design="tw"><p class="w-[calc(100% h-[min(50">x</p></div>';
    await expect(compileStoryCss(allBad)).resolves.not.toBeNull();
  });
});

// The salvage guard itself, tested with an injected throwing build (no current Tailwind input
// throws — the guard exists so a future build() throw can never fail a save).
describe('buildSalvaging', () => {
  const buildThrowingOn = (bad: string[]) => (candidates: string[]) => {
    if (candidates.some(c => bad.includes(c))) throw new Error(`Cannot represent ${bad[0]}`);
    return candidates.map(c => `.${c}{}`).join('');
  };

  it('drops exactly the throwing candidates and compiles the rest', async () => {
    const { buildSalvaging } = await import('../story-css.server');
    const r = buildSalvaging(buildThrowingOn(['bad-1']), ['a', 'bad-1', 'b']);
    expect(r.css).toBe('.a{}.b{}');
    expect(r.dropped).toEqual(['bad-1']);
  });

  it('handles multiple bad candidates scattered through the set', async () => {
    const { buildSalvaging } = await import('../story-css.server');
    const r = buildSalvaging(buildThrowingOn(['x', 'y']), ['x', 'a', 'y', 'b', 'c']);
    expect(r.css).toBe('.a{}.b{}.c{}');
    expect(r.dropped.sort()).toEqual(['x', 'y']);
  });

  it('never throws even when every candidate (and the empty build) fails', async () => {
    const { buildSalvaging } = await import('../story-css.server');
    const r = buildSalvaging(() => { throw new Error('always'); }, ['a', 'b']);
    expect(r.css).toBe('');
    expect(r.dropped.sort()).toEqual(['a', 'b']);
  });
});

// ── jsx-format stories ────────────────────────────────────────────────
describe('jsx-format stories — className candidates + always-compile', () => {
  const JSX_STORY =
    '<div className="p-6 bg-card"><Card className="rounded-xl">' +
    "<span className='text-[13px] text-muted-foreground'>x</span></Card></div>";

  it('extractClassCandidates matches className="…" and className=\'…\' (JSX spelling)', () => {
    const c = extractClassCandidates(JSX_STORY);
    expect(c).toContain('p-6');
    expect(c).toContain('bg-card');
    expect(c).toContain('rounded-xl');
    expect(c).toContain('text-[13px]');
    expect(c).toContain('text-muted-foreground');
  });

  // With the app-CSS mirror carrying only fonts, embed chrome inside a story
  // has exactly one style source — the compiled sheet. The recipe union (kit +
  // EXTRA_CLASS_SOURCES classes) therefore applies to every story, compiled
  // against the token layer so token-backed utilities (bg-muted, animate-spin ring colors)
  // resolve.
  it('a story gets the recipe union + token layer (embeds keep their chrome)', async () => {
    const css = await compileStoryCss('<div data-design="tw" class="p-4">legacy with embeds</div>');
    // Asserted on a kit-sourced union class rather than one of the embed
    // chrome utilities, so the case does not move when embed chrome is reskinned.
    expect(css).toContain('.rounded-xl');    // kit chrome class, NOT in the story markup
    expect(css).toContain('--background');   // token layer present so token utilities resolve
  });

  // The stock shadcn --chart-1..5 would silently recolor embedded charts in
  // unthemed stories (VegaChart reads those tokens wherever they resolve).
  // The NEUTRAL story bodies carry the app palette; [data-theme] blocks still override.
  it('story neutral bodies keep the APP chart palette (no silent embed recolor)', async () => {
    const css = (await compileStoryCss('<div data-design="tw" class="p-2">x</div>'))!;
    expect(css).toContain('--chart-1: #16a085');
    expect(css.slice(0, css.indexOf('[data-theme='))).not.toMatch(/:root[^}]*--chart-1: oklch/);
  });

  it('compileStoryCss compiles a story without the data-design marker', async () => {
    const css = await compileStoryCss('<div className="grid grid-cols-3 bg-red-100">x</div>');
    expect(css).toBeTruthy();
    expect(css).toContain('.grid-cols-3');
    expect(css).toContain('.bg-red-100');
  });
});

// Token layer: jsx stories compile against the shadcn preamble (token utilities like
// bg-card resolve via @theme inline) UNIONED with the registry recipe classes — the shadcn
// component sources use classes (rounded-xl, border, shadow-sm, …) that never appear in the
// story's own markup, so without the base sheet a <Card> renders unstyled.
describe('shadcn token preamble + recipe base sheet', () => {
  it('compiles token utilities used in story markup (bg-card, text-muted-foreground)', async () => {
    const css = (await compileStoryCss('<div className="bg-card text-muted-foreground">x</div>'))!;
    expect(css).toContain('.bg-card');
    expect(css).toContain('var(--card'); // @theme inline: utilities reference the raw token var
    expect(css).toContain('.text-muted-foreground');
  });

  it('includes neutral :root/.dark token defaults so themeless stories look right', async () => {
    const css = (await compileStoryCss('<div className="bg-card">x</div>'))!;
    expect(css).toMatch(/:root\s*\{[^}]*--card:/);
    expect(css).toMatch(/\.dark\s*\{[^}]*--card:/);
    expect(css).toMatch(/--radius:/);
  });

  it('unions the shadcn recipe classes so component chrome is styled without appearing in markup', async () => {
    // A jsx story using <Card> only — "rounded-xl"/"shadow-sm" come from the Card recipe, not the story.
    const css = (await compileStoryCss('<Card className="p-0">x</Card>'))!;
    expect(css).toContain('.rounded-xl');
    expect(css).toContain('.shadow-sm');
  });
});

// A blinking caret is the one animation a document CANNOT author for itself: the markup tier
// rejects <style>, and Tailwind's stock `animate-pulse` only fades to 50% opacity, which reads
// as a soft glow rather than a terminal cursor. So the compile itself ships the keyframes.
describe('compileStoryCss — the caret blink', () => {
  it('compiles animate-caret-blink WITH its keyframes, blinking fully off and fully on', async () => {
    const css = (await compileStoryCss('<span className="animate-caret-blink">x</span>'))!;
    expect(css).toContain('.animate-caret-blink');
    // A utility whose keyframes never made it into the sheet is a static block on the page.
    const keyframes = /@keyframes\s+caret-blink\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(keyframes).not.toBe('');
    // Full transparent to full opaque — no half-opacity fade.
    expect(keyframes).toMatch(/opacity:\s*0\b/);
    expect(keyframes).toMatch(/opacity:\s*1\b/);
    // A hard cut, not an eased fade.
    expect(css).toMatch(/animation:[^;]*caret-blink[^;]*step-end|--animate-caret-blink:[^;]*step-end/);
  });
});

// No candidate filter: CSS is unconstrained, so a jsx story compiles every candidate it uses —
// positioning utilities and external-url arbitrary values included — exactly as Tailwind emits them.
describe('compileStoryCss — every candidate compiles', () => {
  it('keeps fixed/sticky candidates (including variants)', async () => {
    const css = (await compileStoryCss(
      '<div className="fixed md:sticky p-4">x</div>'
    ))!;
    expect(css).toMatch(/position:\s*fixed/);
    expect(css).toMatch(/position:\s*sticky/);
    expect(css).toContain('.p-4');
  });

  it('keeps external-url and data: arbitrary-value candidates', async () => {
    const css = (await compileStoryCss(
      `<div className="bg-[url(https://cdn.example/x.png)] bg-[url(data:image/svg+xml;base64,PHN2Zy8+)] p-2">x</div>`
    ))!;
    expect(css).toContain('https://cdn.example/x.png');
    expect(css).toContain('data:image/svg+xml');
    expect(css).toContain('.p-2');
  });

});

// Theme token blocks: every jsx story's compiledCss ships ALL SIX
// `[data-theme="<name>"]` variable blocks, so switching a story's theme is an attribute
// change only — instant preview, no recompile. Appended AFTER the compiled sheet so the
// attribute-scoped blocks beat the `:root`/`.dark` neutral defaults on document order.
describe('compileStoryCss — theme token blocks', () => {
  it('ships all six [data-theme] blocks, each with its own --primary', async () => {
    const css = (await compileStoryCss('<p className="p-2">x</p>'))!;
    for (const t of STORY_THEMES) {
      expect(css).toContain(`[data-theme="${t.name}"]`);
    }
    const terminal = STORY_THEMES.find(t => t.name === 'terminal')!;
    expect(css).toContain(`--primary: ${terminal.cssVars['--primary']}`);
    // Dual-palette themes: the dark palette rides a `.dark`-COMPOUNDED block on
    // the same element (a class flip), never a descendant re-skin.
    expect(css).toContain(`[data-theme="terminal"].dark`);
    expect(css).not.toContain(`.dark [data-theme="terminal"]`);
  });

  it('theme blocks come AFTER the neutral :root defaults (document order beats equal specificity)', async () => {
    const css = (await compileStoryCss('<p className="p-2">x</p>'))!;
    expect(css.indexOf('[data-theme="modernist"]')).toBeGreaterThan(css.indexOf(':root'));
  });
});
