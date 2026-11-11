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
 * threads, a linked comment, the rail opened, or a selection to comment on.
 */
import { createEffect, createSignal, lazy, Show, Suspense, type JSX } from 'solid-js';
import type { ArtifactRole } from '@artifactbin/contracts';
import type { AnnotationWire } from '@/lib/annotations';
import type { StoryEditSelection } from '@/lib/html-bridge/selection-contract';
import type { DocumentRuntimeRef } from '@/lib/html-reader/document-endpoint';
import { commentAccess } from './comment-access';
import { needsCommentPresentation } from './comment-presentation';
import { SelectionActions } from './SelectionActions';

/** Discussion tools load when there are comments or the reader asks for them. SelectionActions stays eager so the
 * first native selection or right-click keeps its capability bridge. */
const AnnotationLayer = lazy(() => import('./AnnotationLayer').then(m => ({ default: m.AnnotationLayer })));

export interface ReaderDiscussionProps {
  id: string;
  role: ArtifactRole;
  /** The reader is signed in with an account (not a guest, not signed out). */
  accountSession: boolean;
  /** An archived version is shown: read-only. */
  archived: boolean;
  /** The bridge to the document's frame, and whether its controller runs (signs its events with `nonce`). */
  runtimeRef: DocumentRuntimeRef;
  ready: boolean;
  nonce: string | null;
  /** The head the page shows: comments and their screenshots are made against it. */
  editId?: string;
  /** The document owner may delete any comment. */
  canDeleteAny: boolean;
  railOpen: boolean;
  onRailOpenChange: (open: boolean) => void;
  /** The open threads from the document's live stream, null until its first frame. */
  liveAnnotations: AnnotationWire[] | null;
  /** The open threads the page knows of before the layer loads (its served count). */
  openCount: number;
  /** A notification's link (`?comment=` / `?thread=`) is in the address. */
  linked: boolean;
  onAnnotationsChange: (annotations: AnnotationWire[]) => void;
  onOpenThreadChange?: (id: string | null) => void;
  /** The reader must sign in to comment. */
  onSignIn: () => void;
  beforeComment?: (subject: StoryEditSelection) => Promise<StoryEditSelection>;
  membershipRevision?: number;
  /** Where the rail and the composer start (under the page's bar), and app chrome over the document's top. */
  topOffset?: number;
  documentTopInset?: number;
  /** The rail renders INTO this element (a host's panel) instead of its own fixed column. */
  railHost?: HTMLElement | null;
  /** The document's frame, when the page around it can resize it without the window resizing (a host's panel). */
  frame?: Element;
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
  return <>
    <Show when={props.ready && props.nonce}>
      <SelectionActions runtimeRef={props.runtimeRef} nonce={props.nonce} canAnnotate={canStartComment()} onSelect={() => { if (annotatable()) setPickRequested(true); }}
        onAnnotate={(selection) => { if (annotatable()) setInitialSelection(selection); else signIn(); }} />
    </Show>
    <Show when={props.ready && active() && comments().canReadComments}>
      <Suspense fallback={null}><AnnotationLayer id={props.id} canCreateComment={annotatable()} beforeComment={props.beforeComment}
        onSignIn={!props.accountSession && !props.archived ? signIn : undefined} canDeleteAny={props.canDeleteAny} editId={props.editId} runtimeRef={props.runtimeRef} sessionNonce={props.nonce}
        railOpen={props.railOpen} onRailOpenChange={props.onRailOpenChange} membershipRevision={props.membershipRevision} showViewComments={comments().canReadComments} liveAnnotations={props.liveAnnotations}
        initialSelection={initialSelection()} onSelectionConsumed={() => setInitialSelection(null)} onOpenThreadChange={props.onOpenThreadChange}
        pickRequested={pickRequested()} pickOnOpen onAnnotationsChange={props.onAnnotationsChange} topOffset={props.topOffset} documentTopInset={props.documentTopInset}
        railHost={props.railHost} frame={props.frame} /></Suspense>
    </Show>
  </>;
}
