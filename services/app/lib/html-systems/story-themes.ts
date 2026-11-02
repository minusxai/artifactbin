/** Persisted theme metadata and the native design picker palettes. HTML stylesheet delivery belongs to html-systems. */
import type { StoryThemeName, StoryDesignName } from '@/lib/validation/story-theme-names';
import { STORY_THEME_NAMES } from '@/lib/validation/story-theme-names';
import { getStorySystem } from './story-systems';

export type { StoryDesignName };
export { STORY_THEME_NAMES };

interface StoryThemeFonts {
  /** Display (heading) font family — a family registered in lib/html-systems/font-catalog.ts. */
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
  /** One-line personality summary for the picker. */
  description: string;
  fonts: StoryThemeFonts;
  /**
   * The mode this theme is DESIGNED to open in when the author pinned no `colorMode`.
   * Declared, not derived: both palettes exist, so background lightness says nothing
   * about intent.
   */
  defaultMode: 'light' | 'dark';
  /**
   * The LIGHT palette — the full shadcn token contract: exactly the vars TW_INPUT_STORY maps,
   * plus --radius (radius is personality, shared by both modes).
   */
  cssVars: Record<string, string>;
  /**
   * The DARK palette — the same contract MINUS --radius. Emitted as a
   * `[data-theme="<name>"].dark` override after the light block, so flipping the mode class
   * re-keys every token without touching the document.
   */
  darkCssVars: Record<string, string>;
}

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

/** Registry lookup by name (undefined for unknown/null). */
export function getStoryTheme(name: string | null | undefined): StoryTheme | undefined {
  return STORY_THEMES.find(t => t.name === name);
}

/**
 * The design a STORED row renders in: a live theme or design system by its
 * name; an unknown junk name resolves to unthemed rather than being invented.
 * Every serving surface (raw route, events frames, the app page) passes stored
 * meta through here.
 */
export function resolveStoredStoryDesign(
  theme: string | null | undefined,
  colorMode: 'light' | 'dark' | null | undefined,
): { theme: StoryDesignName | null; colorMode: 'light' | 'dark' | null } {
  const mode = colorMode ?? null;
  if (theme == null) return { theme: null, colorMode: mode };
  const live = getStoryTheme(theme) ?? getStorySystem(theme);
  return live ? { theme: live.name, colorMode: mode } : { theme: null, colorMode: mode };
}

/**
 * The mode a document actually paints in BY DEFAULT: the author's stored
 * `colorMode` wins, the theme's declared default is the fallback, light is the
 * floor. (A READER may still flip the rendered mode at view time — that
 * override lives client-side and never reaches this resolution.)
 *
 * Here rather than beside the document builder because BOTH ends need it and
 * only one of them is server-only — the served document (lib/publish/document),
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
  return (getStoryTheme(name) ?? getStorySystem(name))?.defaultMode;
}
