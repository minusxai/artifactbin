/**
 * DRAFTS: a signed-in reader's own unpublished page and the files beside it, shown in a frame on a fresh origin.
 * Nothing is stored in the database, published or uploaded; a draft lives in this process for minutes (./drafts).
 * Entered by app/api/page/drafts (create), server/pages-host (serve) and lib/html-reader/host-shell (`mountDraft`).
 *
 * Rules: only a signed-in page at the app's own origin creates one. Every limit is DRAFT_LIMITS, enforced before
 * anything is planned or parsed, refused as `{error, message}` (DraftRefusalCode). A draft origin is served its
 * document only for a one-time ticket under a document policy with no app door (nativeDraftPolicy), its linked files
 * read-only, no cookie and no door, and reaches nothing else of the app (403 forbidden_origin). A file linked as a
 * dataset is a read-only table read by `sql` in the frame (`config.draft`, the engine at /af/offline-sql.js); the
 * parent relays nothing of the app for it. Checks: __tests__/page-drafts.test.ts,
 * lib/html-reader/__tests__/host-shell-draft.test.ts, lib/html-runtime/__tests__/build.test.ts, and the
 * own-origin-script gate.
 */
export { DRAFT_LIMITS } from './contracts';
export { createDraft, draftDocument, draftFile, DraftRefusal, resetDrafts } from './drafts';
