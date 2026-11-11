import { nativeHtmlModuleResponse } from '@/lib/document-serving';
/** The document host module for another shell on the app's origin (lib/html-reader/host-shell); pinned copies: /af/manifest.json. */
export const GET=(request:Request)=>nativeHtmlModuleResponse(request,'host');
export const HEAD=GET;
