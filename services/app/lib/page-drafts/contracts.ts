/**
 * What a draft may hold (lib/page-drafts): stated here once, enforced by ./drafts, answered to the embedding app with
 * the POST (app/api/page/drafts) and shown by `mountDraft` (lib/html-reader/host-shell) as a refusal's code and message.
 * Browser-safe: no node import. Files beside the page (stylesheets, scripts, images, CSV or JSON datasets), any one
 * file's bytes and all of them together are a published page's (contracts PAGE_FILE_LIMITS). The skill ships the
 * same numbers to agents (skills/artifactbin/scripts/toolbox-limits.mjs, pinned equal by a test).
 */
import { PAGE_FILE_LIMITS } from '@artifactbin/contracts/page-limits';

export const DRAFT_LIMITS = {
  ...PAGE_FILE_LIMITS,
  /** The page's own bytes. */
  htmlBytes: 2_000_000,
  /** Rows in any one linked dataset, and its columns. */
  rows: 50_000,
  columns: 200,
  /** Drafts one reader holds at once, and their assembled bytes: past either, the least recently shown is forgotten. */
  perReader: 20,
  readerBytes: 64_000_000,
  /** How long a draft lives after it was last asked for, and how long its document's one-time ticket waits to be spent. */
  ttlSeconds: 600,
  ticketSeconds: 120,
} as const;

/** A draft's refusal codes (each with a message naming what to fix). */
export type DraftRefusalCode = 'invalid_draft' | 'unresolved_draft_files' | 'invalid_draft_csv' | 'draft_too_large' | 'draft_limit';

/** A draft's link to the install's default connection (`href="default:DB"`), read live only when the embedding app allows it. */
export interface DraftConnection { kind: 'default-connection'; name: string; namespace: string }

/** What the embedding app sends: the page, where it sits in its folder, and the files beside it. */
export interface DraftInput {
  html: string;
  /** The page's own path in its folder (default `index.html`): its relative links resolve from here. */
  entryPath?: string;
  title?: string;
  files: Array<{ path: string; base64: string; contentType?: string }>;
  /**
   * The embedding app's explicit choice, per mount: the page's `default:` links read the install's default connection
   * live, as the signed-in reader, through the parent (POST /api/page/drafts/sql). Absent, they are refused in the frame.
   */
  liveSql?: boolean;
}

