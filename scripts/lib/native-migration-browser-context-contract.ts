/** QA-only Chromium configuration: production pages already run over HTTPS. */
export interface NativeMigrationBrowserContext {
 policy:'exact-local-trustworthy-origins-v1';
 /** Full Chromium new-headless honors the scoped secure-origin override. */
 channel:'chromium';
 origins:readonly string[];
 args:readonly string[];
}
