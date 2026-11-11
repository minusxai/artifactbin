/* @jsxImportSource solid-js */
/**
 * THE READER DISCUSSION'S COMMENTS LAYER, behind its lazy boundary: ./ReaderDiscussion decides when the reader needs it
 * and loads this module then; what only the layer needs is composed here, so none of it is in the eager document page.
 * The layer's own props pass by reference (`LAYER_PROPS`, splitProps); the composition's decisions arrive as accessors.
 */
import { splitProps, type JSX } from 'solid-js';
import { AnnotationLayer, type AnnotationLayerProps } from './AnnotationLayer';
import type { ReaderDiscussionProps, ReaderDiscussionState } from './ReaderDiscussion';

/** The props the layer takes exactly as the discussion's caller gives them, named once. */
const LAYER_PROPS = ['id', 'canDeleteAny', 'editId', 'beforeComment', 'runtimeRef', 'railOpen', 'onRailOpenChange', 'liveAnnotations',
  'onAnnotationsChange', 'onOpenThreadChange', 'membershipRevision', 'topOffset', 'documentTopInset', 'railHost', 'frame'] as const satisfies readonly (keyof AnnotationLayerProps)[];

export type LayerProps = Pick<AnnotationLayerProps, (typeof LAYER_PROPS)[number]>;

export function ReaderDiscussionLayer(props: { discussion: ReaderDiscussionProps; state: ReaderDiscussionState }): JSX.Element {
  const [layer] = splitProps(props.discussion, LAYER_PROPS);
  const discussion = props.discussion;
  const state = props.state;
  return <AnnotationLayer {...layer} canCreateComment={state.comments().canCreateComment}
    onSignIn={!discussion.accountSession && !discussion.archived ? state.signIn : undefined} sessionNonce={discussion.nonce}
    showViewComments={state.comments().canReadComments} initialSelection={state.initialSelection()} onSelectionConsumed={() => state.setInitialSelection(null)}
    pickRequested={state.pickRequested()} pickOnOpen />;
}
