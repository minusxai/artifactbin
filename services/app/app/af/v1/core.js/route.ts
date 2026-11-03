/**
 * KEPT FOR EXISTING PAGES ONLY: serves the legacy core address LEGACY_CORE_PATH (lib/html-page/core-script.ts, which
 * states why it is kept and lists everything that reads it). Delete this route together with that constant when no
 * live page source contains /af/v1/core.js.
 */
import { nativeHtmlCoreResponse } from '@/lib/document-serving';
export const GET=(request:Request)=>nativeHtmlCoreResponse(request);
export const HEAD=(request:Request)=>nativeHtmlCoreResponse(request);
