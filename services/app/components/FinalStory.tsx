/**
 * A SERVED STORY KEPT AS SERVED — the reader of a static document who may
 * neither edit nor comment on it (lib/artifact-page `final`).
 *
 * The server's markup is the finished page for them: nothing in it listens,
 * loads or reads a value (lib/story-ui/kit-chunks isStaticStory). So instead of
 * downloading the story runtime and the kit to hydrate a tree that would never
 * change, the reader takes the served element out of the server's wrapper into
 * the app's tree — exactly where the runtime would have put it — and wires the
 * two behaviours a served story has without one: the outline's clicks and
 * current-section mark, and the scroll marks on wide tables.
 *
 * It answers the page as the runtime would (the same controller): the
 * reader's light/dark choice lands on the story element; anything that needs a
 * runtime — a new version arriving live — asks the page for one
 * (`onNeedRuntime`). The page then mounts the runtime, which hydrates THIS
 * element: before that commit these marks are taken back, so the story is the
 * server's markup again, byte for byte (web/initial-story holds it meanwhile).
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { InlineStoryController } from '@/lib/story-runtime/InlineStoryRuntime';
import { STORY_READER_MODE_MESSAGE } from '@/lib/story-runtime/contract';
import { isStoryDocumentUpdate } from '@/lib/story-runtime/document-update';
import { runtimeId } from '@/lib/story-runtime/runtime-id';
import { clearOutlineMarks, wireOutline } from '@/lib/story-runtime/outline-nav';
import { clearTableMarks, markScrollableTables } from '@/lib/story-runtime/table-scroll';
import { holdInitialStory } from '@/web/initial-story';

export interface FinalStoryProps {
  onController(controller: InlineStoryController | null): void;
  /** Something only a runtime can do was asked for: the page should mount one, which hydrates this story. */
  onNeedRuntime(): void;
}

export function FinalStory(props: FinalStoryProps): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  useLayoutEffect(() => {
    const story = holdInitialStory();
    // Nothing served to keep (it was taken already): the page draws the story with a runtime.
    if (!story) { latest.current.onNeedRuntime(); return; }
    host.current!.appendChild(story);
    const stopOutline = wireOutline(document, story);
    const stopTables = markScrollableTables(document, story);
    const controller: InlineStoryController = {
      nonce: runtimeId(),
      send(command) {
        if (isStoryDocumentUpdate(command)) { controller.update(command); return; }
        const message = command as { type?: string; mode?: string } | null;
        if (message?.type === STORY_READER_MODE_MESSAGE && (message.mode === 'light' || message.mode === 'dark')) story.className = message.mode;
      },
      // A new version is the runtime's to draw.
      update: () => latest.current.onNeedRuntime(),
      // A static story reads no dataset, holds no subscriber and posts nothing.
      invalidate: () => {},
      subscribe: () => () => {},
      getViewportRect: () => new DOMRect(0, 0, window.innerWidth, window.innerHeight),
      dispose: () => {},
    };
    latest.current.onController(controller);
    return () => {
      stopOutline();
      stopTables();
      // The served markup again, for the runtime that hydrates it next.
      clearOutlineMarks(story);
      clearTableMarks(story);
      latest.current.onController(null);
    };
  }, []);
  return <div ref={host} data-mx-story-host="" style={{ display: 'contents' }} />;
}
