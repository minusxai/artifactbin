/**
 * What a draft may hold (lib/page-drafts): stated here once, enforced by ./drafts, answered to the embedding app with
 * the POST (app/api/page/drafts) and shown by `mountDraft` (lib/html-reader/host-shell) as a refusal's code and message.
 * Browser-safe: no node import.
 */
export const DRAFT_LIMITS = {
  /** Files beside the page it may link (stylesheets, scripts, images, CSV or JSON datasets). */
  files: 64,
  /** The page's own bytes. */
  htmlBytes: 2_000_000,
  /** Any one file's bytes. */
  fileBytes: 4_000_000,
  /** The page and its files together. */
  totalBytes: 16_000_000,
  /** Rows in any one linked dataset, and its columns. */
  rows: 50_000,
  columns: 200,
  /** Drafts one reader holds at once, and their bytes. */
  perReader: 20,
  readerBytes: 64_000_000,
  /** How long a draft lives after it was last asked for, and how long its document's one-time ticket waits to be spent. */
  ttlSeconds: 600,
  ticketSeconds: 120,
} as const;

/** A draft's refusal codes (each with a message naming what to fix). */
export type DraftRefusalCode = 'invalid_draft' | 'unresolved_draft_files' | 'invalid_draft_csv' | 'draft_too_large' | 'draft_limit';

/** What the embedding app sends: the page, where it sits in its folder, and the files beside it. */
export interface DraftInput {
  html: string;
  /** The page's own path in its folder (default `index.html`): its relative links resolve from here. */
  entryPath?: string;
  title?: string;
  files: Array<{ path: string; base64: string; contentType?: string }>;
}

