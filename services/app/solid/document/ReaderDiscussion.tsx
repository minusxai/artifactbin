/* @jsxImportSource solid-js */
/**
 * THE READER'S DISCUSSION over a framed document: the selection actions the page grants the frame (SelectionActions)
 * and the comments layer (AnnotationLayer: pins, composer, rail, threads, saved views, mentions). One composition for
 * every place a document is read with its discussion: the app's document page (solid/pages/Document) and a shell on the
 * app's origin that mounts the document with /af/host.js and asks for comments (./browser-host-comments).
 *
 * Who may do what is decided here from the reader's role, exactly as the server's doors decide it again on every
 * request (./comment-access): a reader who may read the document reads its comments; one who may annotate it, signed
 * in, on its live head, writes them. A signed-out reader is offered the comment action and is sent to sign in.
 *
 * The caller keeps the document's live stream (its threads arrive as `liveAnnotations`), the rail's open state and
 * the count it shows; the layer itself loads only once there is something to show (needsCommentPresentation): open
 * threads, a linked comment, the rail opened, or a selection to comment on. Everything that only feeds the layer lives
 * behind that lazy boundary (./ReaderDiscussionLayer), so this module, eager on every document view (the app shell's JS,
 * size target 4 in scripts/build/size-targets.mjs), keeps just the selection bridge and the decision to load it.
 */
import { createEffect, createSignal, lazy, Show, Suspense, type Accessor, type JSX, type Setter } from 'solid-js';
import type { ArtifactRole } from '@artifactbin/contracts';
import type { StoryEditSelection } from '@/lib/html-bridge/selection-contract';
import type { DocumentRuntimeRef } from '@/lib/html-reader/document-endpoint';
import { commentAccess, type CommentAccess } from './comment-access';
import { needsCommentPresentation } from './comment-presentation';
import type { LayerProps } from './ReaderDiscussionLayer';
import { SelectionActions } from './SelectionActions';

/** Discussion tools load when there are comments or the reader asks for them. SelectionActions stays eager so the
 * first native selection or right-click keeps its capability bridge. */
const ReaderDiscussionLayer = lazy(() => import('./ReaderDiscussionLayer').then(m => ({ default: m.ReaderDiscussionLayer })));

/**
 * What the comments layer takes as it is (./ReaderDiscussionLayer `LAYER_PROPS`: the document's `id`; `editId`, the head
 * the page shows, which comments and their screenshots are made against; `canDeleteAny` for the document owner; the
 * rail's open state; the open threads from the document's live stream, null until its first frame; where the rail
 * starts and app chrome over the document's top; `railHost`, an element the rail renders INTO instead of its own fixed
 * column; `frame`, the document's frame when the page around it can resize it without the window resizing), plus what
 * this composition decides from.
 */
export interface ReaderDiscussionProps extends LayerProps {
  role: ArtifactRole;
  /** The reader is signed in with an account (not a guest, not signed out). */
  accountSession: boolean;
  /** An archived version is shown: read-only. */
  archived: boolean;
  /** The bridge to the document's frame, and whether its controller runs (signs its events with `nonce`). */
  runtimeRef: DocumentRuntimeRef;
  ready: boolean;
  nonce: string | null;
  /** The open threads the page knows of before the layer loads (its served count). */
  openCount: number;
  /** A notification's link (`?comment=` / `?thread=`) is in the address. */
  linked: boolean;
  /** The reader must sign in to comment. */
  onSignIn: () => void;
}

/** What this composition decided, handed to the lazy layer as accessors (one object, no forwarding getters). */
export interface ReaderDiscussionState {
  comments: Accessor<CommentAccess>;
  /** Sends a signed-out reader to sign in; nothing for anyone else. */
  signIn: () => void;
  initialSelection: Accessor<StoryEditSelection | null>;
  setInitialSelection: Setter<StoryEditSelection | null>;
  pickRequested: Accessor<boolean>;
}

export function ReaderDiscussion(props: ReaderDiscussionProps): JSX.Element {
  const comments = () => commentAccess(props.role, props.accountSession, props.archived);
  const annotatable = () => comments().canCreateComment;
  // Permission to START the comment flow, not to write a comment: a signed-out reader is offered it and signs in.
  const canStartComment = () => !props.archived && (annotatable() || !props.accountSession);
  const signIn = () => { if (!props.accountSession && !props.archived) props.onSignIn(); };
  const [pickRequested, setPickRequested] = createSignal(false);
  const [initialSelection, setInitialSelection] = createSignal<StoryEditSelection | null>(null);
  const [active, setActive] = createSignal(false);
  createEffect(() => {
    setActive(needsCommentPresentation({ canRead: comments().canReadComments, active: active(), linked: props.linked, railOpen: props.railOpen,
      composing: !!initialSelection(), picking: pickRequested(), openCount: props.openCount, liveCount: props.liveAnnotations?.length ?? 0 }));
  });
  const state: ReaderDiscussionState = { comments, signIn, initialSelection, setInitialSelection, pickRequested };
  return <>
    <Show when={props.ready && props.nonce}>
      <SelectionActions runtimeRef={props.runtimeRef} nonce={props.nonce} canAnnotate={canStartComment()} onSelect={() => { if (annotatable()) setPickRequested(true); }}
        onAnnotate={(selection) => { if (annotatable()) setInitialSelection(selection); else signIn(); }} />
    </Show>
    <Show when={props.ready && active() && comments().canReadComments}>
      <Suspense fallback={null}><ReaderDiscussionLayer discussion={props} state={state} /></Suspense>
    </Show>
  </>;
}
