/**
 * DRAFTS: a signed-in reader's own unpublished page and the files beside it, shown in a frame on a fresh origin.
 * Nothing is stored in the database, published or uploaded; a draft lives in this process for minutes (./drafts).
 * Entered by app/api/page/drafts (create), server/pages-host (serve) and lib/html-reader/host-shell (`mountDraft`).
 */
export { DRAFT_LIMITS } from './contracts';
export { createDraft, draftDocument, draftFile, DraftRefusal, resetDrafts } from './drafts';
