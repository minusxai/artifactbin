import { nativeHtmlModuleResponse } from '@/lib/document-serving';
/** The host module's comments for another shell on the app's origin (solid/document/browser-host-comments); pinned copies: /af/manifest.json. */
export const GET=(request:Request)=>nativeHtmlModuleResponse(request,'hostComments');
export const HEAD=GET;
