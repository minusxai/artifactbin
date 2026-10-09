/**
 * THE CLI'S CONTRACT WITH THE APP, PART 3: what the local preview page's browser bundle uses
 * (services/cli/scripts/build-preview.mjs over `src/preview/client.tsx`; the connect page has its
 * own entry, `./browser-connect`, so it does not carry this page's chrome).
 *
 * Browser code only, each name re-exported from its leaf so the preview bundle never reaches server
 * code or React (services/cli/test/preview.test.ts asserts it on the built bundle). The editing and
 * morph machinery is loaded on demand: the `load*` functions keep each `import()` here, so the
 * bundler still splits those modules into their own chunks.
 */

// ---- Document model, as the browser needs it.
export { parseJsx, serializeJsx } from '../jsx';
export type { JsxNode } from '../jsx';
export { splitHelmet } from '../document/helmet';

// ---- Backend contract: the local preview implements the app's artifact backend.
export { BackendRequestError } from '../artifact-backend/errors';
export type { ArtifactBackend, BackendFeature, EditAnswer } from '../artifact-backend/types';

// ---- Story runtime: the controller protocol between the preview chrome and the compiled document.
export {
  STORY_ANNOTATIONS_MESSAGE, STORY_DOCUMENT_MESSAGE, STORY_EDIT_MODE_MESSAGE, STORY_ROOT_ID,
  STORY_SELECTION_ACTIONS_MESSAGE, STORY_SELECTION_ACTION_MESSAGE, STORY_SELECT_MESSAGE, isEditParentMessage,
} from '../story-runtime/contract';
export type { StoryController, StoryDocumentUpdate } from '../story-runtime/contract';
export { isStoryDocumentUpdate } from '../story-runtime/document-update';
export type { RuntimeChannel } from '../story-runtime/pristine';
export type { FrameEditSession } from '../story-runtime/edit/session';
export type { FrameSelectionActions } from '../story-runtime/edit/selection-actions';
export type { FrameAnnotateSession } from '../story-runtime/edit/annotate';

// ---- Editing, comments and draft morphing, loaded on demand (each its own chunk).
export const loadFrameEditSession = () => import('../story-runtime/edit/session');
export const loadCompiledEditRegions = () => import('../story-runtime/edit/dom-mounter');
export const loadFrameAnnotateSession = () => import('../story-runtime/edit/annotate');
export const loadFrameSelectionActions = () => import('../story-runtime/edit/selection-actions');
export const loadStoryUpdateParts = () => import('../document/update-parts');
export const loadDraftMorph = () => import('../islands/morph/engine');

// ---- Trusted UI: the overlay portal and its styles.
export { trustedPortalOf } from '../islands/trusted-portal';
export { configureTrustedUiStyles } from '../serving/trusted-ui-styles';

// ---- Document chrome (Solid): the page bar, viewport, comments and the in-place editor.
export { TrustedUi } from '../../solid/components/TrustedUi';
export { DocumentTitle, PageBar } from '../../solid/components/PageBar';
export { createDocumentViewport } from '../../solid/document/create-document-viewport';
export { DocumentCommentAction, DocumentEditAction } from '../../solid/document/DocumentBarActions';
export { AnnotationLayer } from '../../solid/document/AnnotationLayer';
export { EditorSourcePanel, EditorToolbar, EditorViewTabs } from '../../solid/editor/EditorChrome';
export { default as SourceEditorPane } from '../../solid/editor/SourceEditorPane';
export { createInPlaceEdit } from '../../solid/editor/create-in-place-edit';
