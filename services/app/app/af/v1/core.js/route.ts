/**
 * KEPT ON PURPOSE: 455 saved pages (3 Nov 2026) load the core from this pre-D17 address, written into their HTML.
 * Their saved source can't be rewritten: registered page queries are bound to a digest of it. Remove this route,
 * LEGACY_CORE_PATH in lib/html-page/core-script.ts and the selector in html-runtime/browser-portable.ts together,
 * only once no live page source contains "/af/v1/core.js".
 */
import { nativeHtmlCoreResponse } from '@/lib/document-serving';
export const GET=(request:Request)=>nativeHtmlCoreResponse(request);
export const HEAD=(request:Request)=>nativeHtmlCoreResponse(request);
