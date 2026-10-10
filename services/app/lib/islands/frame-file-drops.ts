/**
 * A FILE DROPPED ON A FRAMED DOCUMENT IS NOT A NAVIGATION.
 *
 * A file dragged onto a page nothing claims is opened by the browser in its place: dropped on the framed
 * document, the frame would leave the document for the file, and the comment layer and selection with it.
 * So a framed document refuses an UNCLAIMED file drag. Listened for on the window in the bubble phase, after
 * everything inside has had its turn: the editor's image drop (capture phase), an author's own drop zone
 * (which must prevent `dragover` to be one) and a native file input all claim theirs first, and
 * nothing here touches the selection or any other event.
 *
 * Framework-free and value-free: it is part of every framed reader's `@mx/page` chunk (lib/islands/page).
 */
const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
const intoFileInput = (target: EventTarget | null) => !!(target as Element | null)?.closest?.('input[type="file"]');

/** Refuse unclaimed file drops on `win`. Returns the disposer. */
export function refuseFileNavigation(win: Window): () => void {
  const refuse = (event: DragEvent) => {
    if (event.defaultPrevented || !carriesFiles(event) || intoFileInput(event.target)) return;
    event.preventDefault();
    if (event.type === 'dragover' && event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  };
  win.addEventListener('dragover', refuse);
  win.addEventListener('drop', refuse);
  return () => { win.removeEventListener('dragover', refuse); win.removeEventListener('drop', refuse); };
}
