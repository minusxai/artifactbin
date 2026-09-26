/**
 * THE FILE'S HTML — one function writes it, one reads it back.
 *
 * Used by the server at download and by the file's own Save, so a saved copy
 * is byte-for-byte the same shape as a downloaded one. The page is a static
 * shell with three blocks and no server-rendered markup:
 *
 *  - `#afbin-code`  the offline bundle, gzip then base64 (application/octet-stream);
 *  - `#afbin-file`  the ArtifactFile JSON (application/json, `<` escaped);
 *  - a small inline boot script that gunzips `#afbin-code` with
 *    DecompressionStream and runs it as INLINE script text.
 *
 * No Blob URLs, workers or module scripts: Chromium and WebKit refuse them
 * from file:// (probed 2026-09-26). The meta CSP forbids every network
 * request, so a forgotten fetch fails closed instead of calling home.
 */
import type { ArtifactFile } from './file-format';

export const ARTIFACT_FILE_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:";

export interface ArtifactFileParts {
  file: ArtifactFile;
  /** The offline bundle, gzip-compressed then base64-encoded. */
  code: string;
}

/** The complete `.html` text for these parts. Pure; safe for any JSON content (no `</script>` break-out). */
export function renderArtifactFileHtml(parts: ArtifactFileParts): string {
  void parts;
  throw new Error('not implemented: renderArtifactFileHtml');
}

/** Reads the parts back out of a parsed file document (DOMParser or the live page). Throws ArtifactFileError. */
export function readArtifactFileParts(doc: Document): ArtifactFileParts {
  void doc;
  throw new Error('not implemented: readArtifactFileParts');
}
