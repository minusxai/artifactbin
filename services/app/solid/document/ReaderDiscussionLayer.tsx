/* @jsxImportSource solid-js */
/**
 * THE READER DISCUSSION'S COMMENTS LAYER, behind its lazy boundary: ./ReaderDiscussion decides when the reader needs it
 * and loads this module then; what only the layer needs is composed here, so none of it is in the eager document page.
 * The layer's own props pass by reference (`LAYER_PROPS`, splitProps); the composition's decisions arrive as accessors.
 */
import { splitProps, type JSX } from 'solid-js';
import { AnnotationLayer, type AnnotationLayerProps } from './AnnotationLayer';
import type { DiscussionSelection, ReaderDiscussionProps } from './ReaderDiscussion';

/** The props the layer takes exactly as the discussion's caller gives them, named once. */
const LAYER_PROPS = ['id', 'canDeleteAny', 'editId', 'beforeComment',
  'onOpenThreadChange', 'membershipRevision', 'topOffset', 'documentTopInset', 'railHost', 'frame'] as const satisfies readonly (keyof AnnotationLayerProps)[];

export type LayerProps = Pick<AnnotationLayerProps, (typeof LAYER_PROPS)[number]>;

export function ReaderDiscussionLayer(props: { reader: ReaderDiscussionProps; selection: DiscussionSelection }): JSX.Element {
  const [layer] = splitProps(props.reader, LAYER_PROPS);
  const reader = props.reader;
  const discussion = reader.discussion;
  const selection = props.selection;
  return <AnnotationLayer {...layer} runtimeRef={reader.runtimeRef} sessionNonce={reader.nonce}
    canCreateComment={discussion.access().canCreateComment} offerSignIn={discussion.access().offerSignIn} onSignIn={reader.onSignIn}
    showViewComments={discussion.access().canReadComments} railOpen={discussion.railOpen()} onRailOpenChange={discussion.onRailOpenChange}
    liveAnnotations={discussion.live()} onAnnotationsChange={discussion.setLayerAnnotations} linkedComment={discussion.linkedComment}
    initialSelection={selection.initialSelection()} onSelectionConsumed={selection.consumeSelection} pickRequested={selection.pickRequested()} />;
}
