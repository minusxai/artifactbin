/* @jsxImportSource solid-js */
/**
 * THE FIRST FRAME OF EDIT MODE. Pressing edit changes the page at once, in one step: the editor
 * bar's strip and the edit panel's column appear where the editor will draw them, the document
 * keeps its place (the page compensates the bar's height), and a slim bar under the strip runs
 * until the document is editable. The editor's own bar and panel then paint over this in place,
 * so the chrome never jumps between a half-drawn state and the real one.
 */
import { Show, type JSX } from 'solid-js';
import { EDIT_BAR_H } from '@/lib/story-ui/edit-bar';

const LOADING_CSS = `@keyframes mx-edit-loading { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }
@media (prefers-reduced-motion: reduce) { [data-mx-edit-loading] > span { animation: none !important; transform: none !important; width: 100% !important; opacity: .5; } }`;

export interface EditEntryChromeProps {
  /** Where the editor bar sits (under the app bar; 0 on a phone). */
  top: number;
  mode: 'light' | 'dark';
  /** The edit panel's width beside the document; 0 when it opens as sheets instead. */
  panelWidth: number;
  /** The editor has not drawn its bar yet: hold its place. */
  skeleton: boolean;
  /** The document is not editable yet. */
  loading: boolean;
  /** Done: the edit bar is gone and the page is returning to reading (the saved version not drawn yet). */
  leaving?: boolean;
}

export function EditEntryChrome(props: EditEntryChromeProps): JSX.Element {
  return (
    <div class="contents" data-app-appearance={props.mode}>
      <Show when={props.skeleton}>
        <div aria-hidden="true" data-mx-edit-skeleton="bar" class="fixed z-[29] border-b border-edge bg-surface"
          style={{ top: `${props.top}px`, height: `${EDIT_BAR_H}px`, left: '0px', right: '0px' }} />
        <Show when={props.panelWidth > 0}>
          <div aria-hidden="true" data-mx-edit-skeleton="panel" class="fixed bottom-0 right-0 z-[29] border-l border-edge bg-surface"
            style={{ top: `${props.top + EDIT_BAR_H}px`, width: `${props.panelWidth}px` }} />
        </Show>
      </Show>
      <Show when={props.loading}>
        <style>{LOADING_CSS}</style>
        <div role="progressbar" aria-label={props.leaving ? 'Returning to reading' : 'Opening the editor'} data-mx-edit-loading
          class="pointer-events-none fixed left-0 right-0 z-[31] overflow-hidden"
          style={{ top: `${props.leaving ? Math.max(0, props.top - 2) : props.top + EDIT_BAR_H - 2}px`, height: '2px' }}>
          <span class="block h-full w-1/4 bg-accent" style={{ animation: 'mx-edit-loading 1s ease-in-out infinite' }} />
        </div>
      </Show>
    </div>
  );
}
