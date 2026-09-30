/* @jsxImportSource solid-js */
import { createSignal, Show, type JSX } from 'solid-js';
import ArrowUpRight from 'lucide-solid/icons/arrow-up-right';
import ImageIcon from 'lucide-solid/icons/image';
import X from 'lucide-solid/icons/x';
import type { CommentImageWire } from '../../../contracts/src/comment-image';

/** components/CommentScreenshot in SOLID: a saved comment image — a small preview and an explicit full-size reader. */
export function CommentScreenshot(props: { image: CommentImageWire }): JSX.Element {
  let dialog!: HTMLDialogElement;
  const [open, setOpen] = createSignal(false);
  return <div class="mt-2">
    <button type="button" aria-label="Open comment screenshot" onClick={() => { setOpen(true); dialog.showModal?.(); }} class="group block w-full overflow-hidden rounded-lg border border-edge bg-surface text-left transition-colors hover:border-accent/50">
      <img src={props.image.thumbnailUrl} width={props.image.width} height={props.image.height} loading="lazy" alt="Screenshot attached to comment" class="h-auto max-h-48 w-full object-contain" />
      <span class="flex items-center gap-2 border-t border-edge px-3 py-2 text-xs font-medium text-muted group-hover:text-fg"><ImageIcon size={13} />Screenshot<ArrowUpRight size={13} class="ml-auto" /></span>
    </button>
    <dialog ref={dialog} aria-label="Comment screenshot" onClose={() => setOpen(false)} class="m-auto max-h-[94dvh] w-[min(1100px,calc(100vw-24px))] overflow-auto rounded-2xl border border-edge bg-panel p-0 font-sans text-fg shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm">
      <header class="flex items-center gap-3 border-b border-edge px-5 py-4"><span class="flex h-9 w-9 items-center justify-center rounded-lg bg-surface text-muted"><ImageIcon size={18} /></span><div class="flex-1"><h2 class="text-sm font-semibold">Comment screenshot</h2><p class="mt-0.5 text-xs text-muted">{new Date(props.image.capturedAt).toLocaleString()}</p></div><button type="button" aria-label="Close screenshot" onClick={() => dialog.close()} class="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-fg"><X size={18} /></button></header>
      <Show when={open()}><div class="flex justify-center bg-surface p-5 sm:p-8"><img src={props.image.previewUrl} width={props.image.width} height={props.image.height} alt="Full comment screenshot" class="h-auto max-h-[68dvh] max-w-full rounded-sm object-contain shadow-lg" /></div></Show>
      <footer class="flex justify-end border-t border-edge px-5 py-3"><a href={props.image.previewUrl} target="_blank" rel="noreferrer" aria-label="Open screenshot at full size" class="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-accent hover:bg-accent-soft">Open full size<ArrowUpRight size={14} /></a></footer>
    </dialog>
  </div>;
}
