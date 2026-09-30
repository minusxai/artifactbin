/* @jsxImportSource solid-js */
import { Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import Camera from 'lucide-solid/icons/camera';
import SquareDashedMousePointer from 'lucide-solid/icons/square-dashed-mouse-pointer';
import { FeatureGate } from '../components/FeatureGate';
import { RIGHT_RAIL_W } from '@/lib/story/edit-bar';

export function AnnotationRail(props: { open: boolean; onClose: () => void; children: JSX.Element; topOffset?: number; rightInset?: number; host?: HTMLElement; sheet?: boolean; picking?: boolean; onSelect?: () => void; screenshot?: boolean; screenshotUnavailable?: string | null; onScreenshot?: () => void }): JSX.Element {
  const body = () => <section data-capture-chrome aria-label="Annotation sidebar" class={props.sheet ? 'fixed inset-x-0 bottom-0 z-30 max-h-[50vh] overflow-auto rounded-t-xl border border-edge bg-bg p-3' : props.host ? 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-bg p-2.5' : 'fixed bottom-0 z-20 flex flex-col gap-2 overflow-y-auto border-l border-edge bg-bg p-2.5'}
    style={props.sheet || props.host ? undefined : { top: `${props.topOffset ?? 0}px`, right: `${props.rightInset ?? 0}px`, width: `${RIGHT_RAIL_W}px` }}>
    <header class="space-y-3 border-b border-edge pb-3">
      <div class="flex items-center justify-between"><h2 class="font-mono text-xs font-semibold">comments</h2><button type="button" aria-label="Close comments" onClick={props.onClose}>×</button></div>
      <div role="group" aria-label="Comment tools" class="grid grid-cols-2 gap-2">
        <Show when={props.onSelect}><button type="button" aria-label="Select" aria-pressed={props.picking} onClick={props.onSelect}
          class={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border px-3 py-2 ${props.picking ? 'border-accent bg-accent-soft text-accent' : 'border-edge bg-panel text-fg hover:bg-surface'}`}>
          <span class="flex items-center gap-2 text-sm font-semibold"><SquareDashedMousePointer size={18} />Select</span><span class="text-[11px]">Block or text</span>
        </button></Show>
        <Show when={props.onScreenshot}><FeatureGate reason={props.screenshotUnavailable} class="flex">{gate =>
          <button type="button" aria-label="Screenshot" aria-pressed={props.screenshot} onClick={props.onScreenshot} {...gate}
            class={`flex min-h-16 w-full flex-col items-center justify-center gap-1 rounded-lg border px-3 py-2 disabled:opacity-50 ${props.screenshot ? 'border-accent bg-accent-soft text-accent' : 'border-edge bg-panel text-fg hover:bg-surface'}`}>
            <span class="flex items-center gap-2 text-sm font-semibold"><Camera size={18} />Screenshot</span><span class="text-[11px]">Capture an area</span>
          </button>
        }</FeatureGate></Show>
      </div>
      <p class="text-xs text-muted">{props.screenshot ? 'Share this tab, then drag an area.' : 'Click a block or highlight text. No screen sharing.'}</p>
    </header>
    {props.children}
  </section>;
  return <Show when={props.open}><Show when={props.host} fallback={body()}>{host => <Portal mount={host()}>{body()}</Portal>}</Show></Show>;
}
