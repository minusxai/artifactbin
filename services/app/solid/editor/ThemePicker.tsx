/* @jsxImportSource solid-js */
/**
 * Document appearance: the current design, a grid of system thumbnails, and color mode.
 * The thumbnails need no document fonts or component CSS in the app shell.
 * Picking reports metadata to the editor's existing save/preview path. A one-step revert also
 * supports legacy themes and an unset design. On a phone the grid lives in MobileSheet.
 */
import { createSignal, For, Show, type JSX } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import X from 'lucide-solid/icons/x';
import { Popover, type PopoverTriggerAttrs } from '../components/Popover';
import { Tooltip } from '../components/Tooltip';
import MobileSheet, { isPhoneViewport } from '../components/MobileSheet';
import { getStoryTheme, resolveStoryMode } from '@/lib/data/story/story-themes';
import { STORY_SYSTEMS, getStorySystem } from '@/lib/data/story/story-systems';
import type { StoryDesignName } from '@/lib/validation/story-theme-names';
import DesignSystemSpecimen from '../components/DesignSystemSpecimen';

const designEntry = (name: StoryDesignName | null) => getStorySystem(name) ?? getStoryTheme(name);
const designLabel = (name: StoryDesignName | null) => designEntry(name)?.label ?? name ?? 'None';

function ThemeDot(props: { theme: StoryDesignName | null; colorMode?: 'light' | 'dark' | null }): JSX.Element {
  const tokens = () => {
    const entry = designEntry(props.theme);
    return entry ? { ...entry.cssVars, ...(resolveStoryMode(entry.name, props.colorMode) === 'dark' ? entry.darkCssVars : {}) } : {};
  };
  return <span data-theme-swatch aria-hidden="true" class={`inline-block size-2.5 shrink-0 rounded-full ${props.theme ? '' : 'border border-current'}`}
    style={{ ...tokens(), background: 'var(--primary, transparent)' }} />;
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
    { value: null, label: `system default (${props.themeDefault})`, aria: 'Color mode system default' },
    { value: 'light', label: 'light', aria: 'Color mode light' },
    { value: 'dark', label: 'dark', aria: 'Color mode dark' },
  ];
  return <AnchoredPanel label="Color modes" open={isOpen()} onOpenChange={setOpen} class="flex w-max flex-col p-1" tooltip="The mode the document opens in"
    trigger={(attrs) => <button type="button" aria-label="Color mode" ref={(el) => attrs.ref?.(el)} onClick={() => attrs.onClick()} aria-haspopup="true" aria-expanded={isOpen()}
      class="inline-flex h-7 w-full cursor-pointer items-center gap-2 rounded-[4px] px-2 font-mono text-[11px] text-fg hover:bg-raised">
      <span class="capitalize">{props.mode ?? props.themeDefault}</span><ChevronDown size={12} class="ml-auto shrink-0 text-faint" />
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
    <span aria-label={`Page type: ${props.template}`} class="inline-flex items-center rounded-[4px] border border-edge bg-raised px-2 py-0.5 font-mono text-[10px] text-fg capitalize">
      {props.template}
    </span>
  </Show>;
}

export default function ThemePicker(props: { value: StoryDesignName | null; colorMode?: 'light' | 'dark' | null; onPick: (theme: StoryDesignName | null) => void }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [previous, setPrevious] = createSignal<{ before: StoryDesignName | null; after: StoryDesignName } | null>(null);
  const pick = (name: StoryDesignName) => {
    setOpen(false);
    if (name === props.value) return;
    setPrevious({ before: props.value, after: name });
    props.onPick(name);
  };
  return <>
  <AnchoredPanel label="Design systems" open={open()} onOpenChange={setOpen} class="grid max-h-[min(38rem,70dvh)] grid-cols-2 gap-2 overflow-y-auto [scrollbar-width:thin] sm:w-[38rem] sm:grid-cols-3"
    sheetHeader={<div class="flex items-center gap-2 px-1 pb-1">
      <h2 class="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">Design systems</h2>
      <button type="button" aria-label="Close design systems" onClick={() => setOpen(false)}
        class="ml-auto inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[3px] text-muted hover:bg-raised hover:text-fg"><X size={14} stroke-width={1.8} /></button>
    </div>}
    trigger={(attrs) => <button type="button" aria-label="Design system" ref={(el) => attrs.ref?.(el)} onClick={() => attrs.onClick()} aria-haspopup="true" aria-expanded={open()}
      class="inline-flex h-7 w-full cursor-pointer items-center gap-2 rounded-[4px] px-2 font-mono text-[11px] text-fg hover:bg-raised">
      <ThemeDot theme={props.value} colorMode={props.colorMode} /><span class="truncate">{designLabel(props.value)}</span><ChevronDown size={12} class="ml-auto shrink-0 text-faint" />
    </button>}>
    <For each={STORY_SYSTEMS}>{(system) => <button type="button" aria-label={`Design system ${system.label}`} aria-pressed={props.value === system.name}
      onClick={() => pick(system.name)}
      class={`group min-w-0 shrink-0 cursor-pointer overflow-hidden rounded-[4px] border text-left transition-[border-color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-accent ${props.value === system.name ? 'border-accent ring-1 ring-accent' : 'border-edge hover:border-edge-bright hover:shadow-md'}`}>
      <DesignSystemSpecimen system={system} colorMode={props.colorMode} selected={props.value === system.name} />
    </button>}</For>
  </AnchoredPanel>
  <Show when={previous() && props.value === previous()!.after}>
    <button type="button" aria-label="Undo design change" class="cursor-pointer font-mono text-[11px] text-muted underline underline-offset-2 hover:text-fg"
      onClick={() => { const old = previous(); if (old) { setPrevious(null); props.onPick(old.before); } }}>Undo design change</button>
  </Show>
  </>;
}
