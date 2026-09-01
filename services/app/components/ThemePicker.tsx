'use client';

/**
 * The theme control for artifact chrome: one trigger naming the current theme,
 * opening a grid of the REAL preview images (`public/story-themes/<name>.png`).
 *
 * It replaces six flat name-buttons that filled the top bar while saying nothing
 * about what a theme looks like — the previews are the whole point, since a
 * theme is a palette plus a type stack, and neither survives being written out
 * as a word.
 *
 * Deliberately dumb: it reports a pick and closes. Choosing a theme is an EDIT,
 * not a viewer preference (a reader flips only the MODE, never the theme), and
 * the caller is what turns the pick into one — the viewer hands it to edit
 * mode, the editor queues it for save. Cards preview in their EFFECTIVE mode:
 * the document's explicit colorMode, else each theme's own default.
 */
import { Check, ChevronDown, X } from 'lucide-react';
import { useState } from 'react';
import AnchoredPanel from '@/components/AnchoredPanel';
import { getStoryTheme, resolveStoryMode } from '@/lib/data/story/story-themes';
import { STORY_THEME_NAMES, type StoryThemeName } from '@/lib/validation/atlas-schemas';

/**
 * The mode a card should be honest about: the document's explicit colorMode,
 * else THAT theme's own default — so a dark-default theme previews dark in a
 * grid of light ones, and a document pinned dark previews all six dark.
 */
const effectiveMode = (theme: StoryThemeName, colorMode: 'light' | 'dark' | null): 'light' | 'dark' =>
  resolveStoryMode(theme, colorMode);

/**
 * The dot that stands for a theme: its own declared `--primary` — from the
 * palette of the mode it would actually render in — so it can never drift from
 * what it represents (and a new theme needs no entry here).
 * An inline style because the value is a theme variable, not a Tailwind colour —
 * this is app chrome, where `style` is ordinary; the ban is on artifact markup.
 */
const ThemeDot = ({ theme, colorMode = null, className = '' }: { theme: StoryThemeName | null; colorMode?: 'light' | 'dark' | null; className?: string }) => {
  const entry = theme ? getStoryTheme(theme) : undefined;
  const primary = entry
    ? (effectiveMode(entry.name, colorMode) === 'dark' ? entry.darkCssVars : entry.cssVars)['--primary']
    : undefined;
  return (
    <span
      data-theme-swatch
      aria-hidden="true"
      // Unthemed: a hollow ring (in the chrome's own ink, whatever mode that is),
      // since a filled dot would claim a palette the document does not have.
      className={`inline-block size-2.5 shrink-0 rounded-full ${primary ? '' : 'border border-current'} ${className}`}
      style={primary ? { background: primary } : undefined}
    />
  );
};

/**
 * The AUTHOR'S DEFAULT color mode, as a dropdown beside the theme picker.
 * Three states, because null is real: an explicit light, an explicit dark, or
 * "theme default" — the document opens in whatever mode its theme declares
 * (and a change of theme then changes the mode with it). Readers can always
 * flip their own view; this is what the document OPENS as.
 */
export const ModeChip = ({ mode, themeDefault, onPick }: {
  mode: 'light' | 'dark' | null;
  /** What null resolves to — the theme's declared default (light when unthemed). */
  themeDefault: 'light' | 'dark';
  onPick: (mode: 'light' | 'dark' | null) => void;
}) => {
  const [open, setOpen] = useState(false);

  const options: Array<{ value: 'light' | 'dark' | null; label: string; aria: string }> = [
    { value: null, label: `theme default (${themeDefault})`, aria: 'Color mode theme default' },
    { value: 'light', label: 'light', aria: 'Color mode light' },
    { value: 'dark', label: 'dark', aria: 'Color mode dark' },
  ];

  return (
    <AnchoredPanel
      label="Color modes"
      open={open}
      onOpenChange={setOpen}
      className="flex w-max flex-col p-1"
      tooltip="The mode the document opens in"
      trigger={
        <button
          type="button"
          aria-label="Color mode"
          aria-expanded={open}
          className="inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-[4px] border border-edge px-2 font-mono text-xs text-fg hover:bg-raised"
        >
          <span className="normal-case opacity-60">Mode:</span>
          {mode ?? themeDefault}
          <ChevronDown size={12} className="shrink-0 opacity-60" />
        </button>
      }
    >
      {options.map((o) => (
        <button
          key={o.aria}
          type="button"
          aria-label={o.aria}
          aria-pressed={mode === o.value}
          onClick={() => {
            setOpen(false);
            onPick(o.value);
          }}
          className={`flex items-center justify-between gap-3 rounded-[4px] px-2 py-1 text-left font-mono text-xs hover:bg-raised ${
            mode === o.value ? 'text-fg' : 'text-muted'
          }`}
        >
          {o.label}
          {mode === o.value && <Check size={11} className="shrink-0" />}
        </button>
      ))}
    </AnchoredPanel>
  );
};

export const TemplateChip = ({ template }: { template: string | null }) => {
  if (!template) return null;
  return (
    <span
      aria-label="Template"
      className="hidden h-6 items-center gap-1.5 rounded-[4px] border border-edge px-2 font-mono text-xs text-fg capitalize sm:inline-flex"
    >
      <span className="normal-case opacity-60">Template:</span>
      {template}
    </span>
  );
};

export interface ThemePickerProps {
  /** The theme in force, or null for a document that has never been themed. */
  value: StoryThemeName | null;
  /**
   * The document's explicit colorMode (the author default), or null. Each card
   * previews in its EFFECTIVE mode — this, else that theme's own default — so
   * the grid is honest about what a pick would actually look like.
   */
  colorMode?: 'light' | 'dark' | null;
  onPick: (theme: StoryThemeName) => void;
}

/**
 * No `mode` prop: this is APP chrome, so it wears the app's own tokens
 * (`bg-surface`, `text-fg`, `border-edge`) and follows the app light/dark toggle
 * for free — the CSS variables switch on `[data-theme]`. The document's theme
 * decides how the DOCUMENT looks, never how the toolbar around it looks.
 */
export default function ThemePicker({ value, colorMode = null, onPick }: ThemePickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <AnchoredPanel
      label="Themes"
      open={open}
      onOpenChange={setOpen}
      // One column on a phone (two 13rem cards cannot both fit), two in the
      // anchored popover. `sm:` IS the fork — the sheet exists only below it.
      className="grid grid-cols-1 gap-2 sm:w-[26rem] sm:grid-cols-2"
      sheetHeader={
        <div className="flex items-center gap-2 px-1 pb-1">
          <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">themes</h2>
          <button
            type="button"
            aria-label="Close themes"
            onClick={() => setOpen(false)}
            className="ml-auto inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[3px] text-muted hover:bg-raised hover:text-fg"
          >
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>
      }
      trigger={
        // No tooltip: the trigger already names the current theme, and a tip
        // would render over the panel it opens.
        <button
          type="button"
          aria-label="Theme"
          aria-expanded={open}
          className="inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-[4px] border border-edge px-2 font-mono text-xs text-fg capitalize hover:bg-raised"
        >
          <ThemeDot theme={value} colorMode={colorMode} />
          <span className="hidden normal-case opacity-60 sm:inline">Theme:</span>
          <span className="hidden sm:inline">{value ?? 'none'}</span>
          <ChevronDown size={12} className="shrink-0 opacity-60" />
        </button>
      }
    >
      {STORY_THEME_NAMES.map((name) => {
        const current = value === name;
        return (
          <button
            key={name}
            type="button"
            aria-label={`Theme ${name}`}
            aria-pressed={current}
            onClick={() => {
              setOpen(false);
              onPick(name);
            }}
            className={`cursor-pointer overflow-hidden rounded-[4px] border text-left ${
              current ? 'border-accent' : 'border-edge hover:border-edge-bright'
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a static
                preview of a fixed size; the optimizer would add a request per
                theme for six images that never change. */}
            <img
              src={`/story-themes/${name}${effectiveMode(name, colorMode) === 'dark' ? '-dark' : ''}.png`}
              alt=""
              width={640}
              height={400}
              className="block h-auto w-full"
            />
            <span className="flex items-center justify-between px-2 py-1 font-mono text-[11px] text-muted capitalize">
              <span className="flex items-center gap-1.5">
                <ThemeDot theme={name} colorMode={colorMode} />
                {name}
              </span>
              {current && <Check size={11} className="shrink-0" />}
            </span>
          </button>
        );
      })}
    </AnchoredPanel>
  );
}
