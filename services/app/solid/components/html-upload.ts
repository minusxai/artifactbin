/** A local file selection; publication validates the complete native HTML contract server-side. */
interface HtmlUploadFile { name: string; size: number }
export interface HtmlUploadSelection { filename: string; html: string }
type HtmlUploadCheck = { ok: true } | { ok: false; error: string };

import { MAX_DOCUMENT_BYTES } from '@artifactbin/contracts/document-update';
export function checkHtmlUpload(file: HtmlUploadFile): HtmlUploadCheck {
 if (!/\.html?$/i.test(file.name)) return {ok:false,error:'Choose an .html or .htm file.'};
 if (file.size > MAX_DOCUMENT_BYTES) return {ok:false,error:'The HTML file exceeds the 2 MB limit.'};
 return {ok:true};
}
