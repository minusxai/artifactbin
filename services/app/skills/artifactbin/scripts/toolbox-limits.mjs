/**
 * Internal: the server's size limits, so a command refuses what the server would. Sandboxes that
 * check a page before showing it read them too. Used by: toolbox-chart, toolbox-publication-bundle.
 */
export const PAYLOAD_BYTES=4*1024*1024;
export const PAGE_LIMITS=Object.freeze({files:99,htmlBytes:2e6,fileBytes:4e6,totalBytes:16e6,
  rows:5e4,columns:200});
