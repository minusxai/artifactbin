/* @jsxImportSource solid-js */
/**
 * Document appearance: the current design, a grid of system thumbnails, and color mode.
 * The thumbnails need no document fonts or component CSS in the app shell.
 * Picking reports metadata to the editor's existing save/preview path. A one-step revert also
 * supports legacy themes and an unset design. On a phone the grid lives in MobileSheet.
 */
import { createSignal, For, mergeProps, Show, type JSX } from 'solid-js';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import X from 'lucide-solid/icons/x';
import { Badge, MicroLabel } from '../ui/ui';
import { Button } from '../ui/Button';
import { Popover, type PopoverTriggerAttrs } from '../ui/Popover';
import { Select } from '../ui/Select';
import { Tooltip } from '../ui/Tooltip';
import MobileSheet, { isPhoneViewport } from '../ui/MobileSheet';
import { getStoryTheme, resolveStoryMode } from '@/lib/story-design/story-themes';
import { STORY_SYSTEMS, getStorySystem } from '@/lib/story-design/story-systems';
import type { StoryDesignName } from '@/lib/validation';
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
    ? <Tooltip content={props.tooltip}>{props.trigger(mergeProps(attrs, { onClick: toggle }))}</Tooltip>
    : props.trigger(mergeProps(attrs, { onClick: toggle }));
  return <Popover label={props.label} open={props.open} onOpenChange={props.onOpenChange} trigger={trigger}
    class={`p-2 ${props.class}`}>{props.children}</Popover>;
}

const MODE_VALUE = (mode: 'light' | 'dark' | null) => mode ?? '';

export function ModeChip(props: { mode: 'light' | 'dark' | null; themeDefault: 'light' | 'dark'; onPick: (mode: 'light' | 'dark' | null) => void }): JSX.Element {
  const options = () => [
    { value: '', label: `system default (${props.themeDefault})` },
    { value: 'light', label: 'light' },
    { value: 'dark', label: 'dark' },
  ];
  return <Tooltip content="The mode the document opens in">
    <Select size="sm" ariaLabel="Color mode" value={MODE_VALUE(props.mode)} options={options()}
      onChange={(value) => props.onPick(value === 'light' || value === 'dark' ? value : null)} />
  </Tooltip>;
}

export function TemplateChip(props: { template: string | null }): JSX.Element {
  return <Show when={props.template}>
    <span aria-label={`Page type: ${props.template}`} class="inline-flex capitalize"><Badge tone="default">{props.template}</Badge></span>
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
      <h2><MicroLabel>Design systems</MicroLabel></h2>
      <Button variant="ghost" size="sm" icon class="ml-auto" aria-label="Close design systems" onClick={() => setOpen(false)}><X size={14} stroke-width={1.8} /></Button>
    </div>}
    trigger={(attrs) => <Button variant="secondary" size="sm" aria-label="Design system" ref={(el) => attrs.ref?.(el)} onClick={() => attrs.onClick()} aria-haspopup="true" aria-expanded={open()}
      class="w-full font-normal">
      <span class="flex min-w-0 flex-1 items-center gap-2"><ThemeDot theme={props.value} colorMode={props.colorMode} /><span class="truncate">{designLabel(props.value)}</span></span>
      <ChevronDown size={12} aria-hidden="true" class="shrink-0 opacity-60" />
    </Button>}>
    <For each={STORY_SYSTEMS}>{(system) => <Button shape="tile" pressed={props.value === system.name} aria-label={`Design system ${system.label}`}
      onClick={() => pick(system.name)} class="w-full">
      <DesignSystemSpecimen system={system} colorMode={props.colorMode} selected={props.value === system.name} />
    </Button>}</For>
  </AnchoredPanel>
  <Show when={previous() && props.value === previous()!.after}>
    <Button variant="link" aria-label="Undo design change"
      onClick={() => { const old = previous(); if (old) { setPrevious(null); props.onPick(old.before); } }}>Undo design change</Button>
  </Show>
  </>;
}
