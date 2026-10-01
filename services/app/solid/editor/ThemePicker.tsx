/* @jsxImportSource solid-js */
/**
 * The theme control for artifact chrome: one trigger naming the
 * current theme, opening a grid of the REAL preview images (`public/story-themes/<name>.png`), and the
 * author's default color mode beside it. Deliberately dumb: it reports a pick and closes; the editor
 * turns a pick into an edit. On a phone the panel is a bottom sheet (solid/components/MobileSheet).
 */
import { createSignal, For, Show, type JSX } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import X from 'lucide-solid/icons/x';
import { Popover, type PopoverTriggerAttrs } from '../components/Popover';
import { Tooltip } from '../components/Tooltip';
import MobileSheet, { isPhoneViewport } from '../components/MobileSheet';
import { getStoryTheme, resolveStoryMode } from '@/lib/data/story/story-themes';
import { STORY_THEME_NAMES, type StoryThemeName } from '@/lib/validation/atlas-schemas';

const effectiveMode = (theme: StoryThemeName, colorMode: 'light' | 'dark' | null): 'light' | 'dark' => resolveStoryMode(theme, colorMode);

function ThemeDot(props: { theme: StoryThemeName | null; colorMode?: 'light' | 'dark' | null }): JSX.Element {
  const primary = () => {
    const entry = props.theme ? getStoryTheme(props.theme) : undefined;
    return entry ? (effectiveMode(entry.name, props.colorMode ?? null) === 'dark' ? entry.darkCssVars : entry.cssVars)['--primary'] : undefined;
  };
  return <span data-theme-swatch aria-hidden="true" class={`inline-block size-2.5 shrink-0 rounded-full ${primary() ? '' : 'border border-current'}`}
    style={primary() ? { background: primary() } : undefined} />;
}

/** The anchored panel, or a bottom sheet on a phone: the caller holds only `open`. */
function AnchoredPanel(props: {
  label: string; open: boolean; onOpenChange: (open: boolean) => void;
  trigger: (attrs: Partial<PopoverTriggerAttrs> & { onClick: () => void }) => JSX.Element;
  tooltip?: string; sheetHeader?: JSX.Element; class: string; children: JSX.Element;
}): JSX.Element {
  const toggle = () => props.onOpenChange(!props.open);
  const phone = isPhoneViewport();
  if (phone) {
    return <>
      {props.trigger({ onClick: toggle, 'aria-haspopup': 'true', 'aria-expanded': props.open })}
      <Show when={props.open}>
        <MobileSheet label={props.label} onClose={() => props.onOpenChange(false)} header={props.sheetHeader}>
          <div class={props.class}>{props.children}</div>
        </MobileSheet>
      </Show>
    </>;
  }
  const trigger = (attrs: PopoverTriggerAttrs) => props.tooltip
    ? <Tooltip content={props.tooltip}>{props.trigger({ ...attrs, onClick: toggle })}</Tooltip>
    : props.trigger({ ...attrs, onClick: toggle });
  return <Popover label={props.label} open={props.open} onOpenChange={props.onOpenChange} trigger={trigger}
    class={`rounded-[6px] p-2 ${props.class}`}>{props.children}</Popover>;
}

export function ModeChip(props: { mode: 'light' | 'dark' | null; themeDefault: 'light' | 'dark'; onPick: (mode: 'light' | 'dark' | null) => void }): JSX.Element {
  const [isOpen, setOpen] = createSignal(false);
  const options = (): Array<{ value: 'light' | 'dark' | null; label: string; aria: string }> => [
    { value: null, label: `theme default (${props.themeDefault})`, aria: 'Color mode theme default' },
    { value: 'light', label: 'light', aria: 'Color mode light' },
    { value: 'dark', label: 'dark', aria: 'Color mode dark' },
  ];
  return <AnchoredPanel label="Color modes" open={isOpen()} onOpenChange={setOpen} class="flex w-max flex-col p-1" tooltip="The mode the document opens in"
    trigger={(attrs) => <button type="button" aria-label="Color mode" ref={(el) => attrs.ref?.(el)} onClick={() => attrs.onClick()} aria-haspopup="true" aria-expanded={isOpen()}
      class="inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-[4px] border border-edge px-1.5 font-mono text-xs text-fg hover:bg-raised sm:px-2">
      <span class="normal-case opacity-60">Mode:</span><span>{props.mode ?? props.themeDefault}</span><ChevronDown size={12} class="shrink-0 opacity-60" />
    </button>}>
    <For each={options()}>{(o) => <button type="button" aria-label={o.aria} aria-pressed={props.mode === o.value}
      onClick={() => { setOpen(false); props.onPick(o.value); }}
      class={`flex items-center justify-between gap-3 rounded-[4px] px-2 py-1 text-left font-mono text-xs hover:bg-raised ${props.mode === o.value ? 'text-fg' : 'text-muted'}`}>
      {o.label}<Show when={props.mode === o.value}><Check size={11} class="shrink-0" /></Show>
    </button>}</For>
  </AnchoredPanel>;
}

export function TemplateChip(props: { template: string | null }): JSX.Element {
  return <Show when={props.template}>
    <span aria-label="Template" class="inline-flex h-6 items-center gap-1.5 rounded-[4px] border border-edge px-2 font-mono text-xs text-fg capitalize">
      <span class="normal-case opacity-60">Template:</span>{props.template}
    </span>
  </Show>;
}

export default function ThemePicker(props: { value: StoryThemeName | null; colorMode?: 'light' | 'dark' | null; onPick: (theme: StoryThemeName) => void }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return <AnchoredPanel label="Themes" open={open()} onOpenChange={setOpen} class="grid grid-cols-1 gap-2 sm:w-[26rem] sm:grid-cols-2"
    sheetHeader={<div class="flex items-center gap-2 px-1 pb-1">
      <h2 class="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">themes</h2>
      <button type="button" aria-label="Close themes" onClick={() => setOpen(false)}
        class="ml-auto inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[3px] text-muted hover:bg-raised hover:text-fg"><X size={14} stroke-width={1.8} /></button>
    </div>}
    trigger={(attrs) => <button type="button" aria-label="Theme" ref={(el) => attrs.ref?.(el)} onClick={() => attrs.onClick()} aria-haspopup="true" aria-expanded={open()}
      class="inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-[4px] border border-edge px-1.5 font-mono text-xs text-fg capitalize hover:bg-raised sm:px-2">
      <ThemeDot theme={props.value} colorMode={props.colorMode} /><span class="normal-case opacity-60">Theme:</span><span>{props.value ?? 'none'}</span><ChevronDown size={12} class="shrink-0 opacity-60" />
    </button>}>
    <For each={STORY_THEME_NAMES}>{(name) => <button type="button" aria-label={`Theme ${name}`} aria-pressed={props.value === name}
      onClick={() => { setOpen(false); props.onPick(name); }}
      class={`cursor-pointer overflow-hidden rounded-[4px] border text-left ${props.value === name ? 'border-accent' : 'border-edge hover:border-edge-bright'}`}>
      <img src={`/story-themes/${name}${effectiveMode(name, props.colorMode ?? null) === 'dark' ? '-dark' : ''}.png`} alt="" width={640} height={400} class="block h-auto w-full" />
      <span class="flex items-center justify-between px-2 py-1 font-mono text-[11px] text-muted capitalize">
        <span class="flex items-center gap-1.5"><ThemeDot theme={name} colorMode={props.colorMode} />{name}</span>
        <Show when={props.value === name}><Check size={11} class="shrink-0" /></Show>
      </span>
    </button>}</For>
  </AnchoredPanel>;
}
