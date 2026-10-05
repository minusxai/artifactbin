/* @jsxImportSource solid-js */
import { createMemo, createUniqueId, Show, type JSX } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import { resolveStoryMode } from '@/lib/data/story/story-themes';
import type { StorySystem } from '@/lib/data/story/story-systems';
import specimens from './design-system-specimens.json';

export function DesignSystemSpecimenStyles(): JSX.Element {
  return <><link rel="stylesheet" href="/design-system-fonts.css" /><link rel="stylesheet" href="/design-system-specimens.css" /></>;
}

/** The catalogue's repository-owned vector covers, with locally inherited tokens and unique SVG IDs. */
export default function DesignSystemSpecimen(props: { system: StorySystem; colorMode?: 'light' | 'dark' | null; selected?: boolean }): JSX.Element {
  const tokens = () => ({ ...props.system.cssVars, ...(resolveStoryMode(props.system.name, props.colorMode) === 'dark' ? props.system.darkCssVars : {}) });
  const specimen = () => specimens.find(s => s.name === props.system.name)!;
  const prefix = createUniqueId().replace(/[^a-zA-Z0-9_-]/g, '') + '-';
  const svg = createMemo(() => specimen().svg.replace(/id="([^"]+)"/g, `id="${prefix}$1"`).replace(/url\(#([^)]+)\)/g, `url(#${prefix}$1)`));
  return <span data-design-specimen={props.system.name} aria-hidden="true" style={{ ...tokens(), display: 'block', background: 'var(--ds-cover-bg, var(--background))', color: 'var(--foreground)', 'text-transform': 'none', 'letter-spacing': 'normal', 'line-height': '1.2' }}>
    <span class="block aspect-[5/3] overflow-hidden [&>svg]:h-full [&>svg]:w-full [&>svg]:transition-transform [&>svg]:duration-200 motion-safe:group-hover:[&>svg]:scale-[1.035]" innerHTML={svg()} />
    <span style={{ display: 'block', padding: '12px 14px 14px', background: 'var(--card)', color: 'var(--card-foreground)', 'border-top': '1px solid var(--border)' }}>
      <span style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', gap: '8px', 'font-family': 'var(--font-mono)', 'font-size': '8px', 'line-height': '16px', 'letter-spacing': '.1em', 'text-transform': 'uppercase', color: 'var(--muted-foreground)' }}>
        {specimen().mood}<Show when={props.selected}><Check size={12} /></Show>
      </span>
      <span style={{ display: 'block', 'margin-top': '3px', 'font-family': 'var(--font-display)', 'font-size': props.system.name === 'arcade' ? '17px' : '25px', 'font-weight': '700', 'line-height': '1.1' }}>{props.system.label}</span>
    </span>
  </span>;
}

