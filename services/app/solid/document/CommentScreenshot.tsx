/* @jsxImportSource solid-js */
import { createSignal, Show, type JSX } from 'solid-js';
import ArrowUpRight from 'lucide-solid/icons/arrow-up-right';
import ImageIcon from 'lucide-solid/icons/image';
import X from 'lucide-solid/icons/x';
import { Button } from '../ui/Button';
import type { CommentImageWire } from '../../../contracts/src/comment-image';

/**
 * A saved comment image — a small preview and an explicit full-size reader. A captured shot is a "Screenshot";
 * an attached one (pasted, dropped, picked: `method: 'upload'`) is an "Image". An older read carries no method.
 */
export function CommentScreenshot(props: { image: CommentImageWire }): JSX.Element {
  let dialog!: HTMLDialogElement;
  const [open, setOpen] = createSignal(false);
  const noun = () => (props.image.method === 'upload' ? 'Image' : 'Screenshot');
  const word = () => noun().toLowerCase();
  const show = () => { setOpen(true); dialog.showModal?.(); };
  return <div class="mt-2">
    {/* The card is the thumbnail over a ghost Button that opens the reader; a press on the picture itself does the same for a pointer. */}
    <div class="overflow-hidden rounded-panel border border-edge bg-surface">
      <img src={props.image.thumbnailUrl} width={props.image.width} height={props.image.height} loading="lazy" alt={`${noun()} attached to comment`} onClick={show} class="h-auto max-h-48 w-full cursor-zoom-in object-contain" />
      <div class="border-t border-edge p-1">
        <Button variant="ghost" size="sm" aria-label={`Open comment ${word()}`} onClick={show} class="w-full justify-start">
          <ImageIcon size={13} aria-hidden="true" />{noun()}<ArrowUpRight size={13} aria-hidden="true" class="ml-auto" />
        </Button>
      </div>
    </div>
    <dialog ref={dialog} aria-label={`Comment ${word()}`} onClose={() => setOpen(false)} class="m-auto max-h-[94dvh] w-[min(1100px,calc(100vw-24px))] overflow-auto rounded-2xl border border-edge bg-panel p-0 font-sans text-fg shadow-2xl backdrop:bg-bg/80 backdrop:backdrop-blur-sm">
      <header class="flex items-center gap-3 border-b border-edge px-5 py-4"><span class="flex h-9 w-9 items-center justify-center rounded-lg bg-surface text-muted"><ImageIcon size={18} /></span><div class="flex-1"><h2 class="text-sm font-semibold">Comment {word()}</h2><p class="mt-0.5 text-xs text-muted">{new Date(props.image.capturedAt).toLocaleString()}</p></div><Button type="button" variant="ghost" icon aria-label={`Close ${word()}`} onClick={() => dialog.close()}><X size={18} /></Button></header>
      <Show when={open()}><div class="flex justify-center bg-surface p-5 sm:p-8"><img src={props.image.previewUrl} width={props.image.width} height={props.image.height} alt={`Full comment ${word()}`} class="h-auto max-h-[68dvh] max-w-full rounded-sm object-contain shadow-lg" /></div></Show>
      <footer class="flex justify-end border-t border-edge px-5 py-3"><a href={props.image.previewUrl} target="_blank" rel="noreferrer" aria-label={`Open ${word()} at full size`} class="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-accent hover:bg-accent-soft">Open full size<ArrowUpRight size={14} /></a></footer>
    </dialog>
  </div>;
}
