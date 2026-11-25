/**
 * The reader's discussion state before and after the layer mounts. The app and the host supply
 * admission, the location and the rail controls. The layer's list takes over from the live list,
 * and either list (including an empty one) supersedes provisional counts.
 */
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack, type Accessor } from 'solid-js';
import type { ArtifactRole } from '@artifactbin/contracts/sharing';
import type { AnnotationWire } from '@/lib/annotations';
import { commentAccess } from './comment-access';
import { commentLink, openAnnotations } from './comment-presentation';

const currentWindow = (): Window | undefined => typeof window === 'undefined' ? undefined : window;

/** Follow app router changes and browser history on standalone surfaces. */
export function createCommentLink(search?: Accessor<string>, win = currentWindow()) {
  const browserSearch = () => win?.location.search;
  const read = search ?? browserSearch;
  const [link, setLink] = createSignal(commentLink(untrack(read)));
  createEffect(on(read, (value) => setLink(commentLink(value)), { defer: true }));
  onMount(() => {
    if (!win) return;
    const navigate = () => setLink(commentLink(browserSearch()));
    win.addEventListener('popstate', navigate);
    onCleanup(() => win.removeEventListener('popstate', navigate));
  });
  return link;
}

export type ReaderDiscussionState = ReturnType<typeof createReaderDiscussion>;

export function createReaderDiscussion(options: {
  reader: Accessor<{ role: ArtifactRole; accountSession: boolean; archived: boolean }>;
  railOpen: Accessor<boolean>;
  onRailOpenChange: (open: boolean) => void;
  servedCount: Accessor<number | undefined>;
  deferredCount?: Accessor<number | undefined>;
  search?: Accessor<string>;
  win?: Window;
}) {
  const [listed, setLayerAnnotations] = createSignal<AnnotationWire[] | null>(null);
  const [live, setLiveAnnotations] = createSignal<AnnotationWire[] | null>(null);
  const openRows = createMemo(() => {
    const rows = listed() ?? live();
    return rows && openAnnotations(rows);
  });
  const access = createMemo(() => {
    const { role, accountSession, archived } = options.reader();
    return { ...commentAccess(role, accountSession, archived), offerSignIn: !accountSession && !archived };
  });
  const link = createCommentLink(options.search, options.win);
  return {
    access,
    railOpen: options.railOpen,
    onRailOpenChange: options.onRailOpenChange,
    live,
    setLiveAnnotations,
    setLayerAnnotations,
    openRows,
    openCount: () => openRows()?.length ?? options.deferredCount?.() ?? options.servedCount() ?? 0,
    linked: createMemo(() => link().requested),
    linkedComment: createMemo(() => link().target),
  };
}
