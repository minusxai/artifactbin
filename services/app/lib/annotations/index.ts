/** The annotations module's interface: only what other modules import. */
export { annotationAuthorForRequest } from './author';
export { FOLD_LINES, FOLD_STORAGE_KEY, foldFromMeasure, isFolded, readFolds, toggleFold, unfold } from './comment-folds';
export { commentImageResponse, readCommentImage, stageCommentImage } from './comment-images';
export { parseInline, parseMarkdownLite, plainText, safeHref, wrapSelection } from './markdown-lite';
export type { MdNode } from './markdown-lite';
export { mentionDraft } from './mention-draft';
export { readAnnotationPages } from './pages';
export { hasReplyText, remoteWorkLabel, replyMentionPrefix } from './remote-reply';
export { actOnAnnotationFor, countOpenAnnotations, createAnnotationFor, deleteAnnotationFor, listAnnotationPageFor, listAnnotationsFor } from './store';
export type { AnnotationWire, CreateAnnotationInput } from './store';
export { artifactToWireWithAnnotations, artifactWireFor, readArtifactSnapshot, respondToAnnotationAction, respondToAnnotationEdit, respondToCommentReaction } from './wire';

export { readCommentChangesFor, InvalidCommentCursor, CommentWaitCapacityError } from './changes';
export { expireCommentImagesFor, sweepCommentImages } from './comment-images';
export { htmlCommentNodes } from './html-anchor';
export type { MdMarker } from './markdown-lite';
