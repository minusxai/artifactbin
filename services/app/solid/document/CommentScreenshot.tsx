/* @jsxImportSource solid-js */
import { createSignal, Show, type JSX } from 'solid-js';
import type { CommentImageWire } from '../../../contracts/src/comment-image';

/** Saved comment image: a small preview and an explicit full-size reader. */
export function CommentScreenshot(props: { image: CommentImageWire }): JSX.Element {
  let dialog!: HTMLDialogElement;
  const [open, setOpen] = createSignal(false);
  const show = () => { setOpen(true); dialog.showModal(); };
  const close = () => dialog.close();
  return <div class="mt-2">
    <button type="button" aria-label="Open comment screenshot" onClick={show} class="block w-full overflow-hidden rounded border border-edge bg-surface text-left">
      <img src={props.image.thumbnailUrl} width={props.image.width} height={props.image.height} loading="lazy" alt="Screenshot attached to comment" class="max-h-48 w-full object-contain" />
      <span class="block border-t border-edge px-3 py-2 text-xs">Screenshot ↗</span>
    </button>
    <dialog ref={dialog} aria-label="Comment screenshot" onClose={() => setOpen(false)} class="m-auto max-h-[94dvh] w-[min(1100px,calc(100vw-24px))] overflow-auto rounded border border-edge bg-surface p-0 backdrop:bg-black/50">
      <header class="flex items-center justify-between border-b border-edge p-4"><div><h2>Comment screenshot</h2><p>{new Date(props.image.capturedAt).toLocaleString()}</p></div><button type="button" aria-label="Close screenshot" onClick={close}>×</button></header>
      <Show when={open()}><div class="flex justify-center p-5"><img src={props.image.previewUrl} width={props.image.width} height={props.image.height} alt="Full comment screenshot" class="max-h-[68dvh] max-w-full object-contain" /></div></Show>
      <footer class="border-t border-edge p-3 text-right"><a href={props.image.previewUrl} target="_blank" rel="noopener noreferrer" aria-label="Open screenshot at full size">Open full size ↗</a></footer>
    </dialog>
  </div>;
}
