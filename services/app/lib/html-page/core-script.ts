/** D17: the platform core's flat public address. No version or hash; served with a strong ETag and `no-cache`. */
export const RUNTIME_CORE_PATH='/af/core.js';
/**
 * KEPT FOR EXISTING PAGES ONLY (455 live pages on 3 Nov 2026 load the core from this pre-D17 address, written into
 * their saved HTML; it cannot be rewritten while registered page queries bind to a digest of that source).
 * New pages use RUNTIME_CORE_PATH. This constant and `isRuntimeCoreSrc` are the one statement of the address: every
 * reader of it imports them (server/pages-host.ts, html-runtime, offline-dependencies, the skill's bundled
 * preview-export.mjs); app/af/v1/core.js/route.ts serves it, and the skill's raw-shipped preview-platform.mjs keeps
 * one copy a test pins equal to this. Delete all of them together when no live page source contains /af/v1/core.js.
 */
export const LEGACY_CORE_PATH='/af/v1/core.js';
/** A script src that loads the platform core: the D17 address or the legacy one (stored sources keep either). */
export const isRuntimeCoreSrc=(src:string|null|undefined):boolean=>src===RUNTIME_CORE_PATH||src===LEGACY_CORE_PATH;
