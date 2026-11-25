/* @jsxImportSource solid-js */
/**
 * THE READER'S DISCUSSION over a framed document: the selection actions the page grants the frame (SelectionActions)
 * and the comments layer (AnnotationLayer: pins, composer, rail, threads, saved views, mentions). One composition for
 * every place a document is read with its discussion: the app's document page (solid/pages/Document) and a shell on the
 * app's origin that mounts the document with /af/host.js and asks for comments (./browser-host-comments).
 *
 * The caller provides discussion state (admission, the rail, the current address and thread counts).
 * SelectionActions stays eager for the first native selection or right-click. The layer loads when
 * there are threads, a link, an open rail or a selection to comment on. Its own UI stays in the lazy chunk.
 */
import { createEffect, createSignal, lazy, Show, Suspense, type Accessor, type JSX } from 'solid-js';
import type { StoryEditSelection } from '@/lib/html-runtime/bridge/selection-contract';
import type { DocumentRuntimeRef } from '@/lib/html-reader/document-endpoint';
import { needsCommentPresentation } from './comment-presentation';
import type { LayerProps } from './ReaderDiscussionLayer';
import type { ReaderDiscussionState } from './create-reader-discussion';
import { SelectionActions } from './SelectionActions';

/** Discussion tools load when there are comments or the reader asks for them. SelectionActions stays eager so the
 * first native selection or right-click keeps its capability bridge. */
const ReaderDiscussionLayer = lazy(() => import('./ReaderDiscussionLayer').then(m => ({ default: m.ReaderDiscussionLayer })));

export interface ReaderDiscussionProps extends LayerProps {
  discussion: ReaderDiscussionState;
  runtimeRef: DocumentRuntimeRef;
  ready: boolean;
  nonce: string | null;
  onSignIn: () => void;
}

export interface DiscussionSelection {
  initialSelection: Accessor<StoryEditSelection | null>;
  consumeSelection: () => void;
  pickRequested: Accessor<boolean>;
}

export function ReaderDiscussion(props: ReaderDiscussionProps): JSX.Element {
  const discussion = props.discussion;
  const mayCreate = () => discussion.access().canCreateComment;
  const offerSignIn = () => discussion.access().offerSignIn;
  const [pickRequested, setPickRequested] = createSignal(false);
  const [initialSelection, setInitialSelection] = createSignal<StoryEditSelection | null>(null);
  const [active, setActive] = createSignal(false);
  createEffect(() => {
    setActive(needsCommentPresentation({
      canRead: discussion.access().canReadComments, active: active(), linked: discussion.linked(), railOpen: discussion.railOpen(),
      composing: !!initialSelection(), picking: pickRequested(), openCount: discussion.openCount(), liveCount: discussion.live()?.length ?? 0,
    }));
  });
  const selection: DiscussionSelection = { initialSelection, consumeSelection: () => setInitialSelection(null), pickRequested };
  return <>
    <Show when={props.ready && props.nonce}>
      <SelectionActions runtimeRef={props.runtimeRef} nonce={props.nonce} canAnnotate={mayCreate() || offerSignIn()}
        onSelect={() => { if (mayCreate()) setPickRequested(true); }}
        onAnnotate={(value) => { if (mayCreate()) setInitialSelection(value); else if (offerSignIn()) props.onSignIn(); }} />
    </Show>
    <Show when={props.ready && active() && discussion.access().canReadComments}>
      <Suspense fallback={null}><ReaderDiscussionLayer reader={props} selection={selection} /></Suspense>
    </Show>
  </>;
}
