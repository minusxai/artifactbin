/**
 * What one page may bundle, the same for a draft shown in chat (lib/page-drafts) and a published page
 * (lib/html-publication-bundle): files beside the page, any one file's bytes, and all of them together.
 */
export const PAGE_FILE_LIMITS = {files: 99, fileBytes: 4_000_000, totalBytes: 16_000_000} as const;
