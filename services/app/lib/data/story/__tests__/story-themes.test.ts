/**
 * Story design themes — registry + CSS emitter contract.
 *
 * One registry (`STORY_THEMES`), four consumers: the CSS emitter, the picker UI, preview
 * generation, and the font-asset mapping. These tests pin:
 *  - completeness: one entry per schema enum name, with label/description/fonts,
 *  - the DUAL-palette token contract: every var TW_INPUT_JSX maps (+ --radius) present in the
 *    light palette, every color var (no --radius) in the dark palette, and nothing else,
 *  - the emitter: a light `[data-theme="<name>"]` block AND a `.dark`-compounded override per
 *    theme (dark after light, same specificity — mode is a class flip, never a recompile),
 *  - mode resolution: the author's colorMode wins, the theme's declared defaultMode is the
 *    fallback, light is the floor,
 *  - retirement: classical/broadsheet/nocturne alias forward for stored rows.
 */
import { describe, it, expect } from 'vitest';
import {
  STORY_THEMES, STORY_THEME_NAMES, getStoryTheme, storyThemeCss,
  storyThemeDefaultMode, resolveStoryMode, RETIRED_STORY_THEMES, resolveStoredStoryDesign,
} from '../story-themes';
import { renderDoc, skillTree } from '@/lib/skills';

/** Exactly the CSS variables TW_INPUT_JSX maps utilities onto, plus --radius. */
const REQUIRED_VARS = [
  '--background', '--foreground',
  '--card', '--card-foreground',
  '--popover', '--popover-foreground',
  '--primary', '--primary-foreground',
  '--secondary', '--secondary-foreground',
  '--muted', '--muted-foreground',
  '--accent', '--accent-foreground',
  '--destructive', '--destructive-foreground',
  '--border', '--input', '--ring',
  '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5',
  '--radius',
];
/** The dark palette re-declares every COLOR var; --radius is personality and inherits. */
const REQUIRED_DARK_VARS = REQUIRED_VARS.filter((v) => v !== '--radius');

describe('STORY_THEMES registry', () => {
  it('speaks the new six, in enum order', () => {
    expect([...STORY_THEME_NAMES]).toEqual(['modernist', 'organic', 'industry', 'terminal', 'manuscript', 'pop']);
    expect(STORY_THEMES.map(t => t.name)).toEqual([...STORY_THEME_NAMES]);
  });

  it('every theme carries label, description, display/body fonts and a declared defaultMode', () => {
    for (const t of STORY_THEMES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.fonts.display.length).toBeGreaterThan(0);
      expect(t.fonts.body.length).toBeGreaterThan(0);
      expect(['light', 'dark']).toContain(t.defaultMode);
    }
  });

  // A theme's authoring guidance is its docs file — `skills/artifactbin/references/themes-<name>.md`,
  // the one copy agents read — never a field on the StoryTheme entry.
  it("every theme has authoring guidance; retired themes have none", () => {
    for (const name of STORY_THEME_NAMES) {
      const guidance = renderDoc(`artifactbin/references/themes-${name}.md`, 'https://example.test');
      expect(guidance, `${name} guidance`).toBeDefined();
      expect(guidance.length, `${name} guidance`).toBeGreaterThan(200);
      expect(guidance, `${name} Don't section`).toContain("Don't");
      expect(guidance, `${name} style block`).not.toMatch(/<style\b/i);
      expect(guidance, `${name} inline style`).not.toMatch(/\sstyle\s*=/i);
      expect(guidance, `${name} legacy class attr`).not.toMatch(/\bclass="/i);
    }
    for (const name of Object.keys(RETIRED_STORY_THEMES)) {
      expect(skillTree().get(`artifactbin/references/themes-${name}.md`), `${name} guidance retired`).toBeUndefined();
    }
  });

  it('every theme defines the FULL light contract and the full dark color contract', () => {
    for (const t of STORY_THEMES) {
      for (const name of REQUIRED_VARS) {
        expect(t.cssVars[name], `${t.name} light ${name}`).toBeTruthy();
      }
      expect(Object.keys(t.cssVars).sort()).toEqual([...REQUIRED_VARS].sort());
      for (const name of REQUIRED_DARK_VARS) {
        expect(t.darkCssVars[name], `${t.name} dark ${name}`).toBeTruthy();
      }
      expect(Object.keys(t.darkCssVars).sort()).toEqual([...REQUIRED_DARK_VARS].sort());
    }
  });

  it('light palettes are light-grounded and dark palettes dark-grounded (mode is honest)', () => {
    const lightness = (v: string) => Number(v.match(/oklch\(\s*([0-9.]+)/)?.[1]);
    for (const t of STORY_THEMES) {
      expect(lightness(t.cssVars['--background']), `${t.name} light bg`).toBeGreaterThan(0.5);
      expect(lightness(t.darkCssVars['--background']), `${t.name} dark bg`).toBeLessThan(0.5);
    }
  });

  it('radius expresses each personality: modernist 0, organic ≥ 1rem, industry ≤ 0.125rem, pop ≥ 1rem', () => {
    expect(getStoryTheme('modernist')!.cssVars['--radius']).toBe('0rem');
    expect(parseFloat(getStoryTheme('organic')!.cssVars['--radius'])).toBeGreaterThanOrEqual(1);
    expect(parseFloat(getStoryTheme('industry')!.cssVars['--radius'])).toBeLessThanOrEqual(0.125);
    expect(parseFloat(getStoryTheme('pop')!.cssVars['--radius'])).toBeGreaterThanOrEqual(1);
  });

  it('terminal is the mono terminal: mono display AND body, dark by default', () => {
    const terminal = getStoryTheme('terminal')!;
    expect(terminal.fonts.display).toBe('JetBrains Mono');
    expect(terminal.fonts.body).toBe('JetBrains Mono');
    expect(terminal.defaultMode).toBe('dark');
  });

  it('manuscript is the serif slot (classical + broadsheet merged)', () => {
    const m = getStoryTheme('manuscript')!;
    expect(m.fonts.display).toBe('Cormorant Garamond');
    expect(m.fonts.body).toBe('Noto Serif');
    expect(m.defaultMode).toBe('light');
  });

  it('pop leads with the chunky display grotesque', () => {
    expect(getStoryTheme('pop')!.fonts.display).toBe('Bricolage Grotesque');
  });

  it('getStoryTheme resolves by name and is undefined for unknown/null/retired', () => {
    expect(getStoryTheme('terminal')?.label).toBeTruthy();
    expect(getStoryTheme('nocturne')).toBeUndefined();
    expect(getStoryTheme('bogus')).toBeUndefined();
    expect(getStoryTheme(null)).toBeUndefined();
    expect(getStoryTheme(undefined)).toBeUndefined();
  });
});

describe('storyThemeCss emitter', () => {
  const css = storyThemeCss();

  it('emits a light block AND a .dark-compounded override for every theme, dark after light', () => {
    for (const t of STORY_THEMES) {
      const lightAt = css.indexOf(`:root:where([data-theme="${t.name}"])`);
      const darkAt = css.indexOf(`:root:where([data-theme="${t.name}"].dark)`);
      expect(lightAt, `${t.name} light block`).toBeGreaterThanOrEqual(0);
      expect(darkAt, `${t.name} dark block`).toBeGreaterThanOrEqual(0);
      // Same specificity (0,1,0) both — the dark block wins by document order.
      expect(darkAt, `${t.name} dark after light`).toBeGreaterThan(lightAt);
      expect(css).toContain(`--primary: ${t.cssVars['--primary']}`);
      expect(css).toContain(`--primary: ${t.darkCssVars['--primary']}`);
    }
  });

  it('emits font-family rules from the registry fonts (body on the root, display on headings)', () => {
    const terminal = getStoryTheme('terminal')!;
    expect(css).toContain(`"${terminal.fonts.body}"`);
    const manuscript = getStoryTheme('manuscript')!;
    expect(css).toContain(`"${manuscript.fonts.display}"`);
    expect(css).toContain('--font-display:');
    expect(css).toMatch(/:where\(:root:is\([^}]+\)\) :is\(h1, h2, h3, h4, h5, h6\)/);
  });

  it('mono themes scope their mono family to code/pre', () => {
    const withMono = STORY_THEMES.find(t => t.fonts.mono);
    expect(withMono).toBeTruthy();
    expect(css).toContain(`[data-theme="${withMono!.name}"]`);
    expect(css).toContain('--font-mono:');
    expect(css).toContain(') :is(code, pre, kbd, samp)');
  });

  it('makes :root the low-friction authored CSS override contract', () => {
    expect(css).toContain(':root:where([data-theme="terminal"]) {');
    expect(css).toContain('--font-body:');
    expect(css).toContain('--font-display:');
    expect(css).toContain('font-family: var(--font-display)');
    expect(css).toContain(':where(:root:is(');
  });

  // Structural layer (beyond tokens): every theme ships restrained element-level rules —
  // an hr identity and a ::selection tint at minimum — mode-INDEPENDENT (colors go through
  // var(), so the same rule adapts when the palette flips).
  it('every theme carries a structural css layer, scoped to its data-theme selector', () => {
    for (const t of STORY_THEMES) {
      expect(t.css, `${t.name}.css`).toBeTruthy();
      expect(t.css, `${t.name} uses & scope placeholder`).toContain('&');
      expect(css, `${t.name} hr rule emitted`).toContain(`:where(:root[data-theme="${t.name}"]) hr`);
      expect(css, `${t.name} selection rule emitted`).toContain(`:where(:root[data-theme="${t.name}"]) ::selection`);
      expect(css).not.toContain('& hr');
    }
  });

  it('paints the themed root with the theme background and foreground', () => {
    const rootRule = css.slice(0, css.indexOf('}') + 1);
    expect(rootRule).toContain('background-color: var(--background)');
    expect(rootRule).toContain('color: var(--foreground)');
  });
});

describe('mode resolution (dual-palette themes)', () => {
  it('storyThemeDefaultMode reads the declared default; undefined off the registry', () => {
    expect(storyThemeDefaultMode('terminal')).toBe('dark');
    expect(storyThemeDefaultMode('modernist')).toBe('light');
    expect(storyThemeDefaultMode(null)).toBeUndefined();
    expect(storyThemeDefaultMode('nocturne')).toBeUndefined();
  });

  it('resolveStoryMode: author colorMode wins, theme default is the fallback, light the floor', () => {
    expect(resolveStoryMode('terminal', null)).toBe('dark');
    expect(resolveStoryMode('terminal', 'light')).toBe('light');
    expect(resolveStoryMode('modernist', 'dark')).toBe('dark');
    expect(resolveStoryMode('modernist', null)).toBe('light');
    expect(resolveStoryMode(null, 'dark')).toBe('dark');
    expect(resolveStoryMode(null, null)).toBe('light');
  });
});

describe('retired themes alias forward', () => {
  it('the alias table names a live successor and a hint for each retired theme', () => {
    expect(Object.keys(RETIRED_STORY_THEMES).sort()).toEqual(['broadsheet', 'classical', 'nocturne']);
    for (const [name, r] of Object.entries(RETIRED_STORY_THEMES)) {
      expect(STORY_THEME_NAMES, `${name} successor live`).toContain(r.successor);
      expect(r.hint).toContain(r.successor);
    }
  });

  it('resolveStoredStoryDesign: retired names resolve, colorMode carries, nocturne implies dark only when unset', () => {
    expect(resolveStoredStoryDesign('classical', null)).toEqual({ theme: 'manuscript', colorMode: null });
    expect(resolveStoredStoryDesign('broadsheet', 'dark')).toEqual({ theme: 'manuscript', colorMode: 'dark' });
    expect(resolveStoredStoryDesign('nocturne', null)).toEqual({ theme: 'modernist', colorMode: 'dark' });
    expect(resolveStoredStoryDesign('nocturne', 'light')).toEqual({ theme: 'modernist', colorMode: 'light' });
    expect(resolveStoredStoryDesign('terminal', null)).toEqual({ theme: 'terminal', colorMode: null });
    expect(resolveStoredStoryDesign(null, 'dark')).toEqual({ theme: null, colorMode: 'dark' });
    // An unknown junk name is left null rather than invented.
    expect(resolveStoredStoryDesign('bogus', null)).toEqual({ theme: null, colorMode: null });
  });

  it('a theme is ONE personality in two modes: modernist keeps its red in the dark', () => {
    // The dark palette inverts the ground but never changes the hue family —
    // a reader flipping the toggle must recognise the same design.
    const modernist = getStoryTheme('modernist')!;
    const hue = (v: string) => Number(v.match(/oklch\([\d.]+ [\d.]+ ([\d.]+)/)?.[1]);
    expect(hue(modernist.darkCssVars['--primary'])).toBe(hue(modernist.cssVars['--primary']));
  });
});
