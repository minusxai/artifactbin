/**
 * THE EDITOR'S ONE SENDER OF `mx:document` (lib/story-runtime/contract `EditDraft`).
 *
 * Every draft carries what the controller compiles it with — the source, the editor's head, and the
 * theme and colour mode the editor shows NOW. The theme is read at send time, never left out: a draft
 * without it compiles in the stored theme, which lags a pick until the debounced metadata save lands.
 */
import { isWebUrl } from '@/lib/document/asset-url';
import { storyUpdatePartsShared } from '@/lib/document/update-parts';
import { sendDocument, type DocumentRuntimeRef } from '@/lib/story-runtime/document-endpoint';
import { STORY_DOCUMENT_MESSAGE, type EditDraft } from '@/lib/story-runtime/contract';
import type { StoryDesignName } from '@/lib/validation/story-theme-names';

interface EditDraftState {
  editId(): string;
  theme(): StoryDesignName | null;
  colorMode(): 'light' | 'dark';
}

/** Every literal web URL in a stored document was imported by the write that stored it. */
const HELD_ASSETS = isWebUrl;

/** Typing is sent once it pauses this long (or at once on blur, Enter or any other change). */
export const DRAFT_IDLE_MS = 300;

interface EditDraftSender {
  /**
   * `preview`: a saved version shown with editing paused (version history), in the page's current design.
   * `typing`: text typed into prose the editor already shows: held until typing pauses, newest wins.
   */
  (source: string, options?: { preview?: true; typing?: true; redraw?: true }): void;
  /** Send held typing now (blur, Enter). */
  flush(): void;
  /** Drop held typing (the editor is leaving). */
  cancel(): void;
}

export function createEditDraftSender(runtimeRef: DocumentRuntimeRef, state: EditDraftState): EditDraftSender {
  let held: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => { if (timer !== null) clearTimeout(timer); timer = null; held = null; };
  const post = (source: string, options: { preview?: true; typing?: true; redraw?: true }) => {
    // Parsed at send time, not per keystroke: typing pays for no parse of the whole document.
    const parts = storyUpdatePartsShared(source, HELD_ASSETS);
    if (!parts) return;
    const draft: EditDraft = {
      type: STORY_DOCUMENT_MESSAGE, nodes: parts.nodes, source, editId: state.editId(),
      theme: state.theme(), colorMode: state.colorMode(),
      ...(options.preview ? { preview: true } : {}),
      ...(options.typing ? { typing: true } : {}),
      ...(options.redraw ? { redraw: true } : {}),
    };
    sendDocument({ runtimeRef }, draft);
  };
  const flush = () => {
    const source = held;
    cancel();
    if (source !== null) post(source, { typing: true });
  };
  const send = (source: string, options: { preview?: true; typing?: true; redraw?: true } = {}) => {
    if (options.typing && !options.preview) {
      held = source;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, DRAFT_IDLE_MS);
      return;
    }
    // Anything else is drawn now, and carries whatever was typed before it.
    cancel();
    post(source, options);
  };
  return Object.assign(send, { flush, cancel });
}
