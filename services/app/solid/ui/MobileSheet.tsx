/* @jsxImportSource solid-js */
/** A phone dialog with a handle, a fixed header and a scrolling body. */
import { Show, type JSX } from 'solid-js';
import { LAYER } from './layers';
import { PanelSurface } from './PanelSurface';

export default function MobileSheet(props: {
  label: string;
  onClose: () => void;
  size?: 'tall' | 'half';
  header?: JSX.Element;
  children: JSX.Element;
}): JSX.Element {
  const half = () => props.size === 'half';
  return <PanelSurface label={props.label} role="dialog" placement="bottom" layer={LAYER.sheet}
    onClose={props.onClose}
    scrim={half() ? undefined : { label: 'Close sheet', layer: LAYER.sheetBackdrop, shade: 'bg-black/40' }}
    class={`${half() ? 'max-h-[50vh]' : 'max-h-[80vh]'} animate-[sheet-in_.2s_ease-out] pb-[max(0.75rem,env(safe-area-inset-bottom))] text-xs shadow-lg`}>
    <div aria-hidden="true" class="mx-auto mb-2 h-1 w-9 shrink-0 rounded-full bg-edge" />
    <Show when={props.header}><div class="shrink-0">{props.header}</div></Show>
    <div class="min-h-0 flex-1 overflow-y-auto">{props.children}</div>
  </PanelSurface>;
}
