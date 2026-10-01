/**
 * THE EDITOR'S ONE SENDER OF `mx:document` (lib/story-runtime/contract `EditDraft`).
 *
 * Every draft carries what the controller compiles it with — the source, the editor's head, and the
 * theme and colour mode the editor shows NOW. The theme is read at send time, never left out: a draft
 * without it compiles in the stored theme, which lags a pick until the debounced metadata save lands.
 */
import { isWebUrl } from '@/lib/story/asset-url';
import { storyUpdateParts } from '@/lib/story/update-parts';
import { sendDocument, type DocumentRuntimeRef } from '@/lib/story-runtime/document-endpoint';
import { STORY_DOCUMENT_MESSAGE, type EditDraft } from '@/lib/story-runtime/contract';
import type { StoryThemeName } from '@/lib/validation/story-theme-names';

export interface EditDraftState {
  editId(): string;
  theme(): StoryThemeName | null;
  colorMode(): 'light' | 'dark';
}

/** Overrides for one draft: a version preview sends that version's own theme and mode. */
export type EditDraftOverrides = Partial<Pick<EditDraft, 'theme' | 'colorMode' | 'preview'>>;

/** Every literal web URL in a stored document was imported by the write that stored it. */
const HELD_ASSETS = isWebUrl;

export function createEditDraftSender(runtimeRef: DocumentRuntimeRef, state: EditDraftState) {
  return (source: string, over: EditDraftOverrides = {}): void => {
    const parts = storyUpdateParts(source, HELD_ASSETS);
    if (!parts) return;
    const draft: EditDraft = {
      type: STORY_DOCUMENT_MESSAGE, nodes: parts.nodes, source, editId: state.editId(),
      theme: over.theme !== undefined ? over.theme : state.theme(),
      colorMode: over.colorMode ?? state.colorMode(),
      ...(over.preview ? { preview: true } : {}),
    };
    sendDocument({ runtimeRef }, draft);
  };
}
