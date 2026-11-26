/** The annotations module's interface: only what other modules import. */
export { annotationAuthorForRequest } from './author';
export { FOLD_LINES, FOLD_STORAGE_KEY, foldFromMeasure, isFolded, readFolds, toggleFold, unfold } from './comment-folds';
export { commentImageResponse, readCommentImage, stageCommentImage } from './comment-images';
export { mentionDraft } from './mention-draft';
export { readAnnotationPages } from './pages';
export { hasReplyText, replyMentionPrefix } from './remote-reply';
export { actOnAnnotationFor, countOpenAnnotations, createAnnotationFor, deleteAnnotationFor, listAnnotationPageFor, listAnnotationsFor } from './store';
export type { AnnotationWire, CreateAnnotationInput } from './store';
export { artifactToWireWithAnnotations, artifactWireFor, readArtifactSnapshot, respondToAnnotationAction, respondToAnnotationEdit, respondToCommentReaction } from './wire';

export { expireCommentImagesFor, sweepCommentImages } from './comment-images';
