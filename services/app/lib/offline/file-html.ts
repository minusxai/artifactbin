/**
 * THE FILE'S HTML — one function writes it, one reads it back.
 *
 * Used by the server at download and by the file's own Save, so a saved copy
 * is byte-for-byte the same shape as a downloaded one. The page is a static
 * shell with three blocks and no server-rendered markup:
 *
 *  - `#afbin-code`  the offline bundle, gzip then base64 (application/octet-stream);
 *  - `#afbin-file`  the ArtifactFile JSON (application/json, `<` escaped);
 *  - a small inline boot script that gunzips `#afbin-code` with
 *    DecompressionStream and runs it as INLINE script text.
 *
 * No Blob URLs, workers or module scripts: Chromium and WebKit refuse them
 * from file:// (probed 2026-09-26). The meta CSP forbids every network
 * request, so a forgotten fetch fails closed instead of calling home.
 */
import { ArtifactFileError, parseArtifactFile, type ArtifactFile } from './file-format';

export const ARTIFACT_FILE_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:";

export interface ArtifactFileParts {
  file: ArtifactFile;
  /** The offline bundle, gzip-compressed then base64-encoded. */
  code: string;
}

/** Element ids the shell, the boot script and the offline entry agree on. */
export const ARTIFACT_FILE_IDS = { code: 'afbin-code', file: 'afbin-file', root: 'afbin-root', boot: 'afbin-boot' } as const;

/** Shown in place of the document by a browser without DecompressionStream. */
export const ARTIFACT_FILE_UNSUPPORTED = 'This file needs a current version of Chrome, Edge, Firefox or Safari.';
const ARTIFACT_FILE_BROKEN = 'This file is damaged and cannot be opened. Download it again from artifactbin.';

/**
 * The one script the shell runs by itself. Plain ES5-ish text on purpose: it
 * must reach the unsupported-browser message in any browser that runs script
 * at all. It gunzips `#afbin-code` and runs the result as INLINE script text;
 * a data: fetch, a Blob URL or a module would each be refused somewhere.
 */
export const ARTIFACT_FILE_BOOT = `(function(){
var d=document,status=d.getElementById(${JSON.stringify(ARTIFACT_FILE_IDS.boot)});
function fail(m){if(status){status.textContent=m;status.setAttribute('role','alert');}}
if(typeof DecompressionStream!=='function'||typeof Response!=='function'||typeof Uint8Array!=='function'){fail(${JSON.stringify(ARTIFACT_FILE_UNSUPPORTED)});return;}
try{
var raw=atob((d.getElementById(${JSON.stringify(ARTIFACT_FILE_IDS.code)}).textContent||'').replace(/\\s+/g,''));
var bytes=new Uint8Array(raw.length);for(var i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
new Response(new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'))).text().then(function(code){
var s=d.createElement('script');s.textContent=code;d.body.appendChild(s);
},function(){fail(${JSON.stringify(ARTIFACT_FILE_BROKEN)});});
}catch(e){fail(${JSON.stringify(ARTIFACT_FILE_BROKEN)});}
})();`;

/** The boot placeholder's look: system fonts, centred, both colour schemes. */
const BOOT_CSS = 'html{color-scheme:light dark}body{margin:0}#afbin-boot{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#6b6b70;padding:48px 16px;text-align:center;margin:0}';

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/**
 * JSON that is inert inside a `<script type="application/json">`: every `<`
 * escaped, so no `</script>` or `<!--` in any string can end or bend the
 * block. U+2028/9 are escaped too, so the text stays valid if anything ever
 * evaluates it as script.
 */
const scriptSafeJson = (value: unknown) => JSON.stringify(value)
  .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** The complete `.html` text for these parts. Pure; safe for any JSON content (no `</script>` break-out). */
export function renderArtifactFileHtml(parts: ArtifactFileParts): string {
  if (!BASE64.test(parts.code)) throw new ArtifactFileError('The offline bundle is not base64.');
  const title = escapeHtml(parts.file.metadata.title);
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    + `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(ARTIFACT_FILE_CSP)}">\n`
    + '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
    + `<title>${title}</title>\n<style>${BOOT_CSS}</style>\n</head>\n<body>\n`
    + `<div id="${ARTIFACT_FILE_IDS.root}"><p id="${ARTIFACT_FILE_IDS.boot}" role="status">Opening ${title}\u2026</p></div>\n`
    + `<script type="application/octet-stream" id="${ARTIFACT_FILE_IDS.code}">${parts.code}</script>\n`
    + `<script type="application/json" id="${ARTIFACT_FILE_IDS.file}">${scriptSafeJson(parts.file)}</script>\n`
    + `<script>${ARTIFACT_FILE_BOOT}</script>\n</body>\n</html>\n`;
}

/** Reads the parts back out of a parsed file document (DOMParser or the live page). Throws ArtifactFileError. */
export function readArtifactFileParts(doc: Document): ArtifactFileParts {
  const code = doc.getElementById(ARTIFACT_FILE_IDS.code)?.textContent?.replace(/\s+/g, '') ?? '';
  const json = doc.getElementById(ARTIFACT_FILE_IDS.file)?.textContent ?? '';
  if (!code || !json || !BASE64.test(code)) throw new ArtifactFileError(ARTIFACT_FILE_BROKEN);
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new ArtifactFileError(ARTIFACT_FILE_BROKEN); }
  return { file: parseArtifactFile(value), code };
}
