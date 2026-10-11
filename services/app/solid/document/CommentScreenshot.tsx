/* @jsxImportSource solid-js */
import { createSignal, Show, type JSX } from 'solid-js';
import ArrowUpRight from 'lucide-solid/icons/arrow-up-right';
import ImageIcon from 'lucide-solid/icons/image';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import type { CommentImageWire } from '../../../contracts/src/comment-image';

/**
 * A saved comment image — a small preview and an explicit full-size reader. A captured shot is a "Screenshot";
 * an attached one (pasted, dropped, picked: `method: 'upload'`) is an "Image". An older read carries no method.
 */
export function CommentScreenshot(props: { image: CommentImageWire }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const noun = () => (props.image.method === 'upload' ? 'Image' : 'Screenshot');
  const word = () => noun().toLowerCase();
  const show = () => setOpen(true);
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
    <Show when={open()}>
      <Dialog title={`Comment ${word()}`} description={new Date(props.image.capturedAt).toLocaleString()} closeLabel={`Close ${word()}`}
        size="xl" body="flush" lockScroll onClose={() => setOpen(false)}
        footer={<Button variant="secondary" size="sm" href={props.image.previewUrl} target="_blank" rel="noreferrer" aria-label={`Open ${word()} at full size`}>Open full size<ArrowUpRight size={14} /></Button>}>
        <div class="flex justify-center border-y border-edge bg-raised p-5 sm:p-8"><img src={props.image.previewUrl} width={props.image.width} height={props.image.height} alt={`Full comment ${word()}`} class="h-auto max-h-[68dvh] max-w-full rounded-chip object-contain shadow-lg" /></div>
      </Dialog>
    </Show>
  </div>;
}
