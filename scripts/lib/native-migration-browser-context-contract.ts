/** QA-only Chromium configuration: production pages already run over HTTPS. */
export interface NativeMigrationBrowserContext {
 policy:'exact-local-trustworthy-origins-v1';
 origins:readonly string[];
 args:readonly string[];
}
