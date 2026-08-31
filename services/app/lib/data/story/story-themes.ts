/**
 * Story design themes — ONE registry, four consumers:
 *  (a) the CSS emitter (`storyThemeCss` → appended to every jsx story's compiledCss by
 *      lib/data/story/story-css.server.ts, as tiny `[data-theme="<name>"]` variable blocks —
 *      instant in-app theme switching, no recompile),
 *  (b) the settings picker UI (components/ThemePicker) and the Clarify
 *      `type:'design'` preset (lib/branding/story-theme-options.ts projects this registry),
 *  (c) preview-image generation (scripts/generate-theme-previews.ts),
 *  (d) font-asset generation (lib/data/story/story-fonts.ts maps each theme's families to
 *      the bundled font assets).
 *
 * A theme is a PERSONALITY — fonts, radius, structural CSS, a hue family — carried by TWO
 * palettes: `cssVars` (light) and `darkCssVars` (dark), the shadcn/tweakcn token convention.
 * Components and utility classes are identical across themes and modes; the mode is a `.dark`
 * class flip on the document element, never a recompile. Themes set DEFAULTS only — authored
 * Tailwind utilities can override them per element.
 *
 * The MODE a document paints in: the author's stored `colorMode` is the default, the theme's
 * declared `defaultMode` is the fallback, and the READER may flip it at view time (the served
 * document's mode toggle) — see {@link resolveStoryMode}.
 *
 * RETIRED themes (classical, broadsheet, nocturne) live only in
 * {@link RETIRED_STORY_THEMES}: stored rows alias forward through
 * {@link resolveStoredStoryDesign}; publish rejects the names with a hint.
 *
 * FONTS — families vs packaged assets: a theme family must be one the font catalog serves
 * (lib/data/story/story-fonts.ts, generated at install time from the @fontsource packages by
 * scripts/copy-assets.mjs — the CSP forbids font CDNs, so the binaries are copied into
 * public/fonts, never fetched at runtime and never committed). Adding a family = one npm
 * package + one FONT_FILES entry in copy-assets; families outside the catalog fall back to
 * the closest packaged one (documented per theme below).
 */
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';
import { STORY_THEME_NAMES } from '@/lib/validation/atlas-schemas';

export type { StoryThemeName };
export { STORY_THEME_NAMES };

export interface StoryThemeFonts {
  /** Display (heading) font family — a family registered in lib/data/story/story-fonts.ts. */
  display: string;
  /** Body font family. */
  body: string;
  /** Optional mono family for code/pre. */
  mono?: string;
}

export interface StoryTheme {
  /** The schema enum value — what `<theme>…</theme>` carries. */
  name: StoryThemeName;
  /** Short human label for the picker. */
  label: string;
  /** One-line personality summary (picker + Clarify design preset). */
  description: string;
  fonts: StoryThemeFonts;
  /**
   * The mode this theme is DESIGNED to open in when the author pinned no `colorMode`.
   * Declared, not derived: both palettes exist, so background lightness no longer says
   * anything about intent.
   */
  defaultMode: 'light' | 'dark';
  /**
   * The LIGHT palette — the full shadcn token contract: exactly the vars TW_INPUT_JSX maps,
   * plus --radius (radius is personality, shared by both modes).
   */
  cssVars: Record<string, string>;
  /**
   * The DARK palette — the same contract MINUS --radius. Emitted as a
   * `[data-theme="<name>"].dark` override after the light block, so flipping the mode class
   * re-keys every token without touching the document.
   */
  darkCssVars: Record<string, string>;
  /**
   * Structural layer BEYOND tokens — restrained element-level CSS giving the theme a physical
   * personality (rule weight, ::selection tint, blockquote/table treatments), the way a real
   * design system styles primitives, not just colors. Authored with `&` as the theme-scope
   * placeholder; the emitter substitutes `[data-theme="<name>"]`. Mode-INDEPENDENT by
   * construction: colors go through var(), so the same rule adapts when the palette flips.
   */
  css?: string;
}

/** CSS fallback stack per bundled family (the emitter appends it after the quoted family). */
const FAMILY_FALLBACKS: Record<string, string> = {
  'Inter': 'ui-sans-serif, system-ui, sans-serif',
  'Noto Serif': 'Georgia, serif',
  'JetBrains Mono': 'ui-monospace, SFMono-Regular, monospace',
  'Cormorant Garamond': 'Georgia, serif',
  'Bricolage Grotesque': 'ui-sans-serif, system-ui, sans-serif',
};

export const STORY_THEMES: StoryTheme[] = [
  {
    // Stark Swiss editorial: pure white field, near-black ink, ONE red accent, zero radius.
    // Dark side: the SAME identity inverted — neutral ink-black ground, white type, the one
    // red lifted for contrast. Deliberately not a new hue family: a theme is one personality
    // in two modes. (Stored `nocturne` rows alias here with an implied dark mode and adopt
    // this look — the navy/violet palette is retired with the name.)
    name: 'modernist',
    label: 'Modernist',
    description: 'Stark Swiss editorial — white and near-black with one red accent, inverted to ink-black in dark. Zero radius.',
    fonts: { display: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
    defaultMode: 'light',
    css: [
      '& hr { border: none; height: 2px; background: var(--foreground); }',
      // Tint, not the solid button pair: white-on-red measured 3.8:1 in dark
      // mode (WCAG AA needs 4.5) — __tests__/selection-contrast.test.ts.
      '& ::selection { background: color-mix(in oklab, var(--primary) 30%, transparent); }',
      '& blockquote { border-left: none; border-top: 2px solid var(--foreground); padding: 0.75rem 0 0; font-style: normal; font-weight: 600; }',
    ].join('\n'),
    cssVars: {
      '--radius': '0rem',
      '--background': 'oklch(1 0 0)',
      '--foreground': 'oklch(0.15 0 0)',
      '--card': 'oklch(0.99 0 0)',
      '--card-foreground': 'oklch(0.15 0 0)',
      '--popover': 'oklch(1 0 0)',
      '--popover-foreground': 'oklch(0.15 0 0)',
      '--primary': 'oklch(0.55 0.22 27)',
      '--primary-foreground': 'oklch(0.99 0 0)',
      '--secondary': 'oklch(0.955 0 0)',
      '--secondary-foreground': 'oklch(0.2 0 0)',
      '--muted': 'oklch(0.96 0 0)',
      '--muted-foreground': 'oklch(0.45 0 0)',
      '--accent': 'oklch(0.94 0 0)',
      '--accent-foreground': 'oklch(0.15 0 0)',
      '--destructive': 'oklch(0.55 0.22 27)',
      '--destructive-foreground': 'oklch(0.99 0 0)',
      '--border': 'oklch(0.88 0 0)',
      '--input': 'oklch(0.88 0 0)',
      '--ring': 'oklch(0.55 0.22 27)',
      '--chart-1': 'oklch(0.55 0.22 27)',
      '--chart-2': 'oklch(0.25 0 0)',
      '--chart-3': 'oklch(0.6 0 0)',
      '--chart-4': 'oklch(0.8 0 0)',
      '--chart-5': 'oklch(0.42 0.15 27)',
    },
    darkCssVars: {
      '--background': 'oklch(0.16 0 0)',
      '--foreground': 'oklch(0.93 0 0)',
      '--card': 'oklch(0.2 0 0)',
      '--card-foreground': 'oklch(0.93 0 0)',
      '--popover': 'oklch(0.2 0 0)',
      '--popover-foreground': 'oklch(0.93 0 0)',
      '--primary': 'oklch(0.62 0.21 27)',
      '--primary-foreground': 'oklch(0.98 0 0)',
      '--secondary': 'oklch(0.25 0 0)',
      '--secondary-foreground': 'oklch(0.93 0 0)',
      '--muted': 'oklch(0.24 0 0)',
      '--muted-foreground': 'oklch(0.65 0 0)',
      '--accent': 'oklch(0.28 0 0)',
      '--accent-foreground': 'oklch(0.95 0 0)',
      '--destructive': 'oklch(0.62 0.21 27)',
      '--destructive-foreground': 'oklch(0.98 0 0)',
      '--border': 'oklch(0.95 0 0 / 14%)',
      '--input': 'oklch(0.95 0 0 / 18%)',
      '--ring': 'oklch(0.62 0.21 27)',
      '--chart-1': 'oklch(0.62 0.21 27)',
      '--chart-2': 'oklch(0.85 0 0)',
      '--chart-3': 'oklch(0.6 0 0)',
      '--chart-4': 'oklch(0.4 0 0)',
      '--chart-5': 'oklch(0.72 0.15 27)',
    },
  },
  {
    // Warm, soft, playful: sand field, terracotta primary, olive support, extra-round corners.
    // Dark side: deep moss ground, cream foreground, the terracotta lifted for contrast.
    name: 'organic',
    label: 'Organic',
    description: 'Warm, soft, playful — sage green, terracotta, leafy chart tones; deep moss in dark. Extra-round corners.',
    fonts: { display: 'Noto Serif', body: 'Inter' },
    defaultMode: 'light',
    css: [
      '& hr { border: none; height: 4px; width: 4rem; margin-inline: 0; border-radius: 999px; background: var(--primary); opacity: 0.45; }',
      '& ::selection { background: color-mix(in oklab, var(--primary) 30%, transparent); }',
      '& blockquote { border-left: none; background: var(--muted); border-radius: 1.5rem; padding: 1rem 1.5rem; font-style: normal; }',
    ].join('\n'),
    cssVars: {
      '--radius': '1rem',
      '--background': 'oklch(0.965 0.018 120)',
      '--foreground': 'oklch(0.3 0.04 130)',
      '--card': 'oklch(0.985 0.012 115)',
      '--card-foreground': 'oklch(0.3 0.04 130)',
      '--popover': 'oklch(0.985 0.012 115)',
      '--popover-foreground': 'oklch(0.3 0.04 130)',
      '--primary': 'oklch(0.6 0.15 40)',
      '--primary-foreground': 'oklch(0.98 0.01 110)',
      '--secondary': 'oklch(0.9 0.05 125)',
      '--secondary-foreground': 'oklch(0.33 0.05 130)',
      '--muted': 'oklch(0.92 0.025 118)',
      '--muted-foreground': 'oklch(0.47 0.04 125)',
      '--accent': 'oklch(0.88 0.06 130)',
      '--accent-foreground': 'oklch(0.32 0.04 130)',
      '--destructive': 'oklch(0.55 0.19 28)',
      '--destructive-foreground': 'oklch(0.98 0.01 110)',
      '--border': 'oklch(0.87 0.03 118)',
      '--input': 'oklch(0.87 0.03 118)',
      '--ring': 'oklch(0.6 0.15 40)',
      '--chart-1': 'oklch(0.62 0.14 40)',
      '--chart-2': 'oklch(0.6 0.14 200)',
      '--chart-3': 'oklch(0.64 0.12 87)',
      '--chart-4': 'oklch(0.47 0.11 140)',
      '--chart-5': 'oklch(0.58 0.11 350)',
    },
    darkCssVars: {
      '--background': 'oklch(0.22 0.03 130)',
      '--foreground': 'oklch(0.93 0.02 110)',
      '--card': 'oklch(0.26 0.035 128)',
      '--card-foreground': 'oklch(0.93 0.02 110)',
      '--popover': 'oklch(0.26 0.035 128)',
      '--popover-foreground': 'oklch(0.93 0.02 110)',
      '--primary': 'oklch(0.68 0.14 40)',
      '--primary-foreground': 'oklch(0.2 0.03 130)',
      '--secondary': 'oklch(0.3 0.04 128)',
      '--secondary-foreground': 'oklch(0.93 0.02 110)',
      '--muted': 'oklch(0.29 0.03 126)',
      '--muted-foreground': 'oklch(0.7 0.03 120)',
      '--accent': 'oklch(0.33 0.05 130)',
      '--accent-foreground': 'oklch(0.95 0.015 110)',
      '--destructive': 'oklch(0.62 0.19 28)',
      '--destructive-foreground': 'oklch(0.97 0.01 110)',
      '--border': 'oklch(0.93 0.02 110 / 14%)',
      '--input': 'oklch(0.93 0.02 110 / 18%)',
      '--ring': 'oklch(0.68 0.14 40)',
      '--chart-1': 'oklch(0.68 0.14 40)',
      '--chart-2': 'oklch(0.68 0.12 200)',
      '--chart-3': 'oklch(0.75 0.11 87)',
      '--chart-4': 'oklch(0.65 0.12 140)',
      '--chart-5': 'oklch(0.68 0.11 350)',
    },
  },
  {
    // Professional, square: slate neutrals, industrial blue, a safety-orange chart accent.
    // Dark side: dark slate, lifted blue; safety orange stays the ONE exception hue.
    name: 'industry',
    label: 'Industry',
    description: 'Professional, square — slate and industrial blue, safety-orange for the one exception; dark slate in dark.',
    fonts: { display: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
    defaultMode: 'light',
    css: [
      '& hr { border: none; height: 1px; background: repeating-linear-gradient(90deg, var(--foreground) 0 6px, transparent 6px 10px); opacity: 0.5; }',
      '& ::selection { background: color-mix(in oklab, var(--primary) 30%, transparent); }',
      '& table { font-variant-numeric: tabular-nums; }',
      '& th { text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.8em; }',
    ].join('\n'),
    cssVars: {
      '--radius': '0.125rem',
      '--background': 'oklch(0.975 0.004 250)',
      '--foreground': 'oklch(0.24 0.02 255)',
      '--card': 'oklch(0.995 0.002 250)',
      '--card-foreground': 'oklch(0.24 0.02 255)',
      '--popover': 'oklch(0.995 0.002 250)',
      '--popover-foreground': 'oklch(0.24 0.02 255)',
      '--primary': 'oklch(0.5 0.13 250)',
      '--primary-foreground': 'oklch(0.98 0.004 250)',
      '--secondary': 'oklch(0.93 0.008 250)',
      '--secondary-foreground': 'oklch(0.28 0.02 255)',
      '--muted': 'oklch(0.93 0.008 250)',
      '--muted-foreground': 'oklch(0.47 0.02 255)',
      '--accent': 'oklch(0.9 0.02 250)',
      '--accent-foreground': 'oklch(0.26 0.02 255)',
      '--destructive': 'oklch(0.55 0.21 28)',
      '--destructive-foreground': 'oklch(0.98 0.004 250)',
      '--border': 'oklch(0.87 0.01 250)',
      '--input': 'oklch(0.87 0.01 250)',
      '--ring': 'oklch(0.5 0.13 250)',
      '--chart-1': 'oklch(0.52 0.13 250)',
      '--chart-2': 'oklch(0.35 0.03 255)',
      '--chart-3': 'oklch(0.68 0.16 55)',
      '--chart-4': 'oklch(0.62 0.05 245)',
      '--chart-5': 'oklch(0.8 0.14 90)',
    },
    darkCssVars: {
      '--background': 'oklch(0.21 0.02 255)',
      '--foreground': 'oklch(0.93 0.01 250)',
      '--card': 'oklch(0.25 0.02 255)',
      '--card-foreground': 'oklch(0.93 0.01 250)',
      '--popover': 'oklch(0.25 0.02 255)',
      '--popover-foreground': 'oklch(0.93 0.01 250)',
      '--primary': 'oklch(0.65 0.12 250)',
      '--primary-foreground': 'oklch(0.16 0.02 255)',
      '--secondary': 'oklch(0.29 0.02 255)',
      '--secondary-foreground': 'oklch(0.93 0.01 250)',
      '--muted': 'oklch(0.28 0.02 255)',
      '--muted-foreground': 'oklch(0.68 0.02 252)',
      '--accent': 'oklch(0.32 0.03 250)',
      '--accent-foreground': 'oklch(0.95 0.01 250)',
      '--destructive': 'oklch(0.62 0.19 28)',
      '--destructive-foreground': 'oklch(0.97 0.005 250)',
      '--border': 'oklch(0.92 0.01 250 / 14%)',
      '--input': 'oklch(0.92 0.01 250 / 18%)',
      '--ring': 'oklch(0.65 0.12 250)',
      '--chart-1': 'oklch(0.65 0.12 250)',
      '--chart-2': 'oklch(0.75 0.02 255)',
      '--chart-3': 'oklch(0.7 0.17 55)',
      '--chart-4': 'oklch(0.6 0.05 245)',
      '--chart-5': 'oklch(0.82 0.13 90)',
    },
  },
  {
    // Terminal: mono everything, green phosphor voice. Dark-first (near-black, neon green);
    // the light side is a paper terminal (warm off-white, the green darkened to ink weight).
    name: 'terminal',
    label: 'Terminal',
    description: 'Terminal — mono type throughout, near-black with neon green by default; a paper terminal in light.',
    fonts: { display: 'JetBrains Mono', body: 'JetBrains Mono', mono: 'JetBrains Mono' },
    defaultMode: 'dark',
    css: [
      '& hr { border: none; height: 1px; background: var(--primary); opacity: 0.4; }',
      '& ::selection { background: var(--primary); color: var(--primary-foreground); }',
      '& blockquote { border-left: 2px solid var(--primary); padding-left: 1.25rem; font-style: normal; }',
      '& :is(h1, h2, h3) { letter-spacing: -0.02em; }',
    ].join('\n'),
    cssVars: {
      '--radius': '0.125rem',
      '--background': 'oklch(0.97 0.005 145)',
      '--foreground': 'oklch(0.22 0.02 150)',
      '--card': 'oklch(0.99 0.003 145)',
      '--card-foreground': 'oklch(0.22 0.02 150)',
      '--popover': 'oklch(0.99 0.003 145)',
      '--popover-foreground': 'oklch(0.22 0.02 150)',
      '--primary': 'oklch(0.5 0.14 145)',
      '--primary-foreground': 'oklch(0.98 0.005 145)',
      '--secondary': 'oklch(0.93 0.01 145)',
      '--secondary-foreground': 'oklch(0.26 0.02 150)',
      '--muted': 'oklch(0.94 0.008 145)',
      '--muted-foreground': 'oklch(0.45 0.03 148)',
      '--accent': 'oklch(0.9 0.03 145)',
      '--accent-foreground': 'oklch(0.24 0.02 150)',
      '--destructive': 'oklch(0.55 0.21 28)',
      '--destructive-foreground': 'oklch(0.98 0.005 145)',
      '--border': 'oklch(0.87 0.01 145)',
      '--input': 'oklch(0.87 0.01 145)',
      '--ring': 'oklch(0.5 0.14 145)',
      '--chart-1': 'oklch(0.5 0.14 145)',
      '--chart-2': 'oklch(0.55 0.11 210)',
      '--chart-3': 'oklch(0.55 0.18 330)',
      '--chart-4': 'oklch(0.65 0.13 80)',
      '--chart-5': 'oklch(0.4 0.01 150)',
    },
    darkCssVars: {
      '--background': 'oklch(0.14 0.01 150)',
      '--foreground': 'oklch(0.9 0.05 145)',
      '--card': 'oklch(0.18 0.015 150)',
      '--card-foreground': 'oklch(0.9 0.05 145)',
      '--popover': 'oklch(0.18 0.015 150)',
      '--popover-foreground': 'oklch(0.9 0.05 145)',
      '--primary': 'oklch(0.85 0.22 145)',
      '--primary-foreground': 'oklch(0.14 0.01 150)',
      '--secondary': 'oklch(0.22 0.02 150)',
      '--secondary-foreground': 'oklch(0.9 0.05 145)',
      '--muted': 'oklch(0.22 0.02 150)',
      '--muted-foreground': 'oklch(0.65 0.06 145)',
      '--accent': 'oklch(0.26 0.04 148)',
      '--accent-foreground': 'oklch(0.92 0.05 145)',
      '--destructive': 'oklch(0.65 0.2 25)',
      '--destructive-foreground': 'oklch(0.95 0.02 145)',
      '--border': 'oklch(0.85 0.1 145 / 16%)',
      '--input': 'oklch(0.85 0.1 145 / 20%)',
      '--ring': 'oklch(0.85 0.22 145)',
      '--chart-1': 'oklch(0.85 0.22 145)',
      '--chart-2': 'oklch(0.8 0.13 210)',
      '--chart-3': 'oklch(0.7 0.2 330)',
      '--chart-4': 'oklch(0.85 0.15 85)',
      '--chart-5': 'oklch(0.7 0.15 300)',
    },
  },
  {
    // The serif slot — classical + broadsheet merged: bookish cream/sepia with the oxblood
    // accent, plus broadsheet's typeset table headers. Dark side: warm ink (brown-black,
    // cream text, ochre accent) — a reading-lamp page, not a screen inversion.
    name: 'manuscript',
    label: 'Manuscript',
    description: 'Serif editorial — cream paper, sepia ink, oxblood accent; warm ink with ochre in dark. Cormorant Garamond display over Noto Serif.',
    fonts: { display: 'Cormorant Garamond', body: 'Noto Serif' },
    defaultMode: 'light',
    css: [
      '& hr { border: none; height: 1px; background: var(--border); }',
      '& ::selection { background: color-mix(in oklab, var(--primary) 25%, transparent); }',
      '& blockquote { font-style: italic; border-left: 1px solid var(--border); padding-left: 1.25rem; }',
      '& th { text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.85em; }',
      // Cormorant runs light and small at a given size: give headings the
      // weight and slight tightening a garamond display cut expects.
      '& :is(h1, h2, h3) { font-weight: 600; letter-spacing: -0.01em; }',
    ].join('\n'),
    cssVars: {
      '--radius': '0.375rem',
      '--background': 'oklch(0.965 0.02 90)',
      '--foreground': 'oklch(0.28 0.03 55)',
      '--card': 'oklch(0.98 0.015 90)',
      '--card-foreground': 'oklch(0.28 0.03 55)',
      '--popover': 'oklch(0.98 0.015 90)',
      '--popover-foreground': 'oklch(0.28 0.03 55)',
      '--primary': 'oklch(0.45 0.14 25)',
      '--primary-foreground': 'oklch(0.97 0.02 90)',
      '--secondary': 'oklch(0.92 0.03 85)',
      '--secondary-foreground': 'oklch(0.32 0.04 60)',
      '--muted': 'oklch(0.93 0.025 88)',
      '--muted-foreground': 'oklch(0.48 0.04 60)',
      '--accent': 'oklch(0.9 0.045 80)',
      '--accent-foreground': 'oklch(0.3 0.04 55)',
      '--destructive': 'oklch(0.5 0.19 30)',
      '--destructive-foreground': 'oklch(0.97 0.02 90)',
      '--border': 'oklch(0.86 0.03 85)',
      '--input': 'oklch(0.86 0.03 85)',
      '--ring': 'oklch(0.45 0.14 25)',
      '--chart-1': 'oklch(0.5 0.13 25)',
      '--chart-2': 'oklch(0.47 0.1 245)',
      '--chart-3': 'oklch(0.64 0.12 75)',
      '--chart-4': 'oklch(0.46 0.12 130)',
      '--chart-5': 'oklch(0.63 0.12 92)',
    },
    darkCssVars: {
      '--background': 'oklch(0.2 0.02 55)',
      '--foreground': 'oklch(0.92 0.02 85)',
      '--card': 'oklch(0.24 0.025 55)',
      '--card-foreground': 'oklch(0.92 0.02 85)',
      '--popover': 'oklch(0.24 0.025 55)',
      '--popover-foreground': 'oklch(0.92 0.02 85)',
      '--primary': 'oklch(0.72 0.12 80)',
      '--primary-foreground': 'oklch(0.2 0.02 55)',
      '--secondary': 'oklch(0.28 0.03 60)',
      '--secondary-foreground': 'oklch(0.92 0.02 85)',
      '--muted': 'oklch(0.27 0.025 58)',
      '--muted-foreground': 'oklch(0.68 0.03 75)',
      '--accent': 'oklch(0.31 0.04 70)',
      '--accent-foreground': 'oklch(0.94 0.02 85)',
      '--destructive': 'oklch(0.6 0.17 30)',
      '--destructive-foreground': 'oklch(0.96 0.01 85)',
      '--border': 'oklch(0.9 0.02 85 / 14%)',
      '--input': 'oklch(0.9 0.02 85 / 18%)',
      '--ring': 'oklch(0.72 0.12 80)',
      '--chart-1': 'oklch(0.72 0.12 80)',
      '--chart-2': 'oklch(0.62 0.1 245)',
      '--chart-3': 'oklch(0.6 0.13 25)',
      '--chart-4': 'oklch(0.62 0.1 130)',
      '--chart-5': 'oklch(0.75 0.1 92)',
    },
  },
  {
    // Chunky, saturated, loud: candy magenta over near-white, big radii, heavy headings.
    // Dark side: deep plum with the candy hues brightened to stay luminous.
    name: 'pop',
    label: 'Pop',
    description: 'Playful and loud — candy magenta, cyan and amber over near-white, chunky radii, heavy Bricolage Grotesque headings; deep plum in dark.',
    fonts: { display: 'Bricolage Grotesque', body: 'Inter' },
    defaultMode: 'light',
    css: [
      '& hr { border: none; height: 6px; width: 5rem; margin-inline: 0; border-radius: 999px; background: var(--primary); }',
      // Tint, not the solid button pair: white-on-hot-pink measured 3.6:1 in
      // light mode (WCAG AA needs 4.5) — __tests__/selection-contrast.test.ts.
      '& ::selection { background: color-mix(in oklab, var(--primary) 30%, transparent); }',
      '& blockquote { border-left: none; background: var(--secondary); border-radius: 1.5rem; padding: 1rem 1.5rem; font-style: normal; font-weight: 600; }',
      '& :is(h1, h2, h3) { font-weight: 800; letter-spacing: -0.02em; }',
    ].join('\n'),
    cssVars: {
      '--radius': '1.5rem',
      '--background': 'oklch(0.99 0.005 340)',
      '--foreground': 'oklch(0.2 0.02 320)',
      '--card': 'oklch(1 0 0)',
      '--card-foreground': 'oklch(0.2 0.02 320)',
      '--popover': 'oklch(1 0 0)',
      '--popover-foreground': 'oklch(0.2 0.02 320)',
      '--primary': 'oklch(0.65 0.25 350)',
      '--primary-foreground': 'oklch(0.99 0.005 340)',
      '--secondary': 'oklch(0.93 0.04 330)',
      '--secondary-foreground': 'oklch(0.25 0.03 330)',
      '--muted': 'oklch(0.95 0.02 330)',
      '--muted-foreground': 'oklch(0.5 0.05 330)',
      '--accent': 'oklch(0.9 0.06 200)',
      '--accent-foreground': 'oklch(0.22 0.03 220)',
      '--destructive': 'oklch(0.6 0.22 25)',
      '--destructive-foreground': 'oklch(0.99 0.005 340)',
      '--border': 'oklch(0.88 0.02 330)',
      '--input': 'oklch(0.88 0.02 330)',
      '--ring': 'oklch(0.65 0.25 350)',
      '--chart-1': 'oklch(0.65 0.25 350)',
      '--chart-2': 'oklch(0.7 0.13 210)',
      '--chart-3': 'oklch(0.8 0.16 85)',
      '--chart-4': 'oklch(0.55 0.2 300)',
      '--chart-5': 'oklch(0.7 0.18 45)',
    },
    darkCssVars: {
      '--background': 'oklch(0.2 0.05 320)',
      '--foreground': 'oklch(0.95 0.01 330)',
      '--card': 'oklch(0.25 0.06 320)',
      '--card-foreground': 'oklch(0.95 0.01 330)',
      '--popover': 'oklch(0.25 0.06 320)',
      '--popover-foreground': 'oklch(0.95 0.01 330)',
      '--primary': 'oklch(0.72 0.24 350)',
      '--primary-foreground': 'oklch(0.18 0.04 320)',
      '--secondary': 'oklch(0.3 0.07 320)',
      '--secondary-foreground': 'oklch(0.95 0.01 330)',
      '--muted': 'oklch(0.29 0.05 320)',
      '--muted-foreground': 'oklch(0.72 0.05 330)',
      '--accent': 'oklch(0.35 0.08 310)',
      '--accent-foreground': 'oklch(0.96 0.01 330)',
      '--destructive': 'oklch(0.65 0.2 25)',
      '--destructive-foreground': 'oklch(0.97 0.01 330)',
      '--border': 'oklch(0.95 0.02 330 / 14%)',
      '--input': 'oklch(0.95 0.02 330 / 18%)',
      '--ring': 'oklch(0.72 0.24 350)',
      '--chart-1': 'oklch(0.72 0.24 350)',
      '--chart-2': 'oklch(0.78 0.13 210)',
      '--chart-3': 'oklch(0.85 0.15 85)',
      '--chart-4': 'oklch(0.65 0.2 300)',
      '--chart-5': 'oklch(0.75 0.17 45)',
    },
  },
];

/** Registry lookup by name (undefined for unknown/null/retired). */
export function getStoryTheme(name: string | null | undefined): StoryTheme | undefined {
  return STORY_THEMES.find(t => t.name === name);
}

/**
 * RETIRED themes — the ONLY place their names survive as values. Stored rows
 * alias forward through {@link resolveStoredStoryDesign}; publish rejects the
 * name with `hint`. `impliedColorMode` fires only when the row pinned no
 * colorMode: nocturne was a dark design, so its successor must open dark.
 */
export const RETIRED_STORY_THEMES: Record<string, { successor: StoryThemeName; impliedColorMode?: 'dark'; hint: string }> = {
  classical: { successor: 'manuscript', hint: "theme 'classical' is retired — use 'manuscript' (the serif editorial theme)" },
  broadsheet: { successor: 'manuscript', hint: "theme 'broadsheet' is retired — use 'manuscript' (the serif editorial theme)" },
  nocturne: { successor: 'modernist', impliedColorMode: 'dark', hint: "theme 'nocturne' is retired — use 'modernist' with colorMode 'dark' (its dark mode is the same red on ink-black)" },
};

/**
 * Read-path aliasing for STORED rows: a retired theme name resolves to its
 * successor (with the implied mode when the row pinned none); an unknown junk
 * name resolves to unthemed rather than being invented. Every serving surface
 * (raw route, events frames, the app page) passes stored meta through here, so
 * a pre-retirement row keeps rendering — and self-heals to the new vocabulary
 * on its owner's next save.
 */
export function resolveStoredStoryDesign(
  theme: string | null | undefined,
  colorMode: 'light' | 'dark' | null | undefined,
): { theme: StoryThemeName | null; colorMode: 'light' | 'dark' | null } {
  const mode = colorMode ?? null;
  if (theme == null) return { theme: null, colorMode: mode };
  const retired = RETIRED_STORY_THEMES[theme];
  if (retired) return { theme: retired.successor, colorMode: mode ?? retired.impliedColorMode ?? null };
  const live = getStoryTheme(theme);
  return live ? { theme: live.name, colorMode: mode } : { theme: null, colorMode: mode };
}

/**
 * The mode a document actually paints in BY DEFAULT: the author's stored
 * `colorMode` wins, the theme's declared default is the fallback, light is the
 * floor. (A READER may still flip the rendered mode at view time — that
 * override lives client-side and never reaches this resolution.)
 *
 * Here rather than beside the document builder because BOTH ends need it and
 * only one of them is server-only — the served document (lib/story/document),
 * the edit canvas, and the page's loading ground must resolve this identically
 * or a reader watches the same document paint twice in two different modes.
 */
export function resolveStoryMode(
  theme: string | null | undefined,
  colorMode: 'light' | 'dark' | null | undefined,
): 'light' | 'dark' {
  return colorMode ?? storyThemeDefaultMode(theme) ?? 'light';
}

/**
 * The mode a theme is DESIGNED to open in — the declared `defaultMode`.
 * Undefined for unknown/absent themes (unthemed stories follow `colorMode`,
 * then the container's default).
 */
export function storyThemeDefaultMode(name: string | null | undefined): 'dark' | 'light' | undefined {
  return getStoryTheme(name)?.defaultMode;
}

const fontStack = (family: string): string =>
  `"${family}", ${FAMILY_FALLBACKS[family] ?? 'sans-serif'}`;

const varsBlock = (vars: Record<string, string>): string =>
  Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n');

/**
 * Emit ALL themes' variable + font-family blocks as one CSS string. Appended
 * AFTER the compiled utility sheet so the attribute-scoped blocks beat the
 * `:root`/`.dark` neutral defaults on document order; authored Tailwind
 * utilities then consume the resolved variables per element.
 *
 * Every theme emits TWO palette blocks: the light base
 * (`:root:where([data-theme="x"])`, which also carries the fonts and radius)
 * and the dark override (`:root:where([data-theme="x"].dark)`) — same (0,1,0)
 * specificity, dark after light, so the mode is a class flip on the document
 * element and an authored `:root { --primary: … }` override still wins by
 * coming later, in BOTH modes.
 */
export function storyThemeCss(): string {
  // The theme lives on the iframe document element. `:root` is therefore the
  // stable author contract for overrides: an authored style block appears
  // after this sheet, and its `:root { --primary: … }` ties specificity with
  // these defaults and wins by source order.
  const rootSel = `:root:where(:is(${STORY_THEMES.map((t) => `[data-theme="${t.name}"]`).join(', ')}))`;
  // Keep heading/code defaults deliberately low-specificity so an ordinary
  // authored class can replace font-family without `!important`.
  const descendantScope = `:where(:root:is(${STORY_THEMES.map((t) => `[data-theme="${t.name}"]`).join(', ')}))`;
  const blocks: string[] = [
    // Paint the document root: overriding --background on :root repaints the
    // actual page ground, not just an authored child.
    `${rootSel} {\n  background-color: var(--background);\n  color: var(--foreground);\n  font-family: var(--font-body);\n}`,
    `${descendantScope} :is(h1, h2, h3, h4, h5, h6) {\n  font-family: var(--font-display);\n}`,
    `${descendantScope} :is(code, pre, kbd, samp) {\n  font-family: var(--font-mono);\n}`,
  ];
  for (const t of STORY_THEMES) {
    // Variables must tie the neutral :root block's specificity and come
    // later. Structural personality rules are true defaults: :where removes
    // the theme scope's weight so an ordinary authored class beats them.
    const varsSel = `:root:where([data-theme="${t.name}"])`;
    const darkSel = `:root:where([data-theme="${t.name}"].dark)`;
    const structuralSel = `:where(:root[data-theme="${t.name}"])`;
    blocks.push(`${varsSel} {\n${varsBlock({
      ...t.cssVars,
      '--font-body': fontStack(t.fonts.body),
      '--font-display': fontStack(t.fonts.display),
      '--font-mono': fontStack(t.fonts.mono ?? t.fonts.body),
    })}\n}`);
    blocks.push(`${darkSel} {\n${varsBlock(t.darkCssVars)}\n}`);
    // Structural layer: `&` is the theme-scope placeholder (see StoryTheme.css).
    if (t.css) {
      blocks.push(t.css.replaceAll('&', structuralSel));
    }
  }
  return blocks.join('\n');
}
