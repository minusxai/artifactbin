/**
 * `createWideEditViewport`: is the
 * window wide enough for the edit panel to sit beside the document (edit-bar's
 * EDIT_PANEL_BREAKPOINT)? LIVE — a window dragged across the line swaps the
 * side panel for bottom sheets.
 *
 * `readEditPanelCollapsed`/`writeEditPanelCollapsed`/`editPanelWidth` are
 * already framework-free (plain localStorage + arithmetic); a Solid page uses
 * those from lib/story/reader/use-edit-panel directly, unchanged.
 */
import { createSignal, onCleanup, onMount, type Accessor } from 'solid-js';
import { isWideEditViewport } from '@/lib/story-ui/edit-bar';

export function createWideEditViewport(): Accessor<boolean> {
  const [wide, setWide] = createSignal(isWideEditViewport());
  onMount(() => {
    const onResize = () => setWide(isWideEditViewport());
    onResize();
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));
  });
  return wide;
}

export { readEditPanelCollapsed, writeEditPanelCollapsed, editPanelWidth } from '@/lib/story/reader/use-edit-panel';
