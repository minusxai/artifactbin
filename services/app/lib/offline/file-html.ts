/**
 * THE FILE'S HTML — one function writes it, one reads it back.
 *
 * Used by the server at download and by the file's own Save, so a saved copy
 * is byte-for-byte the same shape as a downloaded one. The page is a static
 * shell with no server-rendered markup:
 *
 *  - right after the doctype, a plain-English note for a coding agent asked
 *    to edit the file (artifactFileAgentNote), and in `<head>` the same
 *    discovery tags every served page carries (lib/agent-discovery-tags) —
 *    neither is fetched;
 *  - `#afbin-file`  the ArtifactFile JSON (application/json, `<` escaped),
 *    `source` its second key — FIRST, so a reader that stops early sees it;
 *  - `#afbin-code`  the offline bundle, gzip then base64 (application/octet-stream);
 *  - a small inline boot script that gunzips `#afbin-code` with
 *    DecompressionStream and runs it as INLINE script text.
 *
 * No Blob URLs, workers or module scripts: Chromium and WebKit refuse them
 * from file:// (probed 2026-09-26). The meta CSP forbids every network
 * request but one — code view's extras script from the file's own origin
 * (lib/offline/extras) — so a forgotten fetch fails closed instead of calling home.
 */
import { escapeHtml, scriptJson } from '@artifactbin/utils/escape';
import { agentDiscovery, agentDiscoveryHead } from '@/lib/serving/agent-discovery-tags';
import { documentRootAttributes } from '@/lib/story/styles/document-root';
import { inlineStoryElement } from '@/lib/compiled-page/story-element';
import { withModuleDataId } from '@/lib/compiled-page/carriers';
import { ArtifactFileError, parseArtifactFile, type ArtifactFile } from './file-format';

/** The file's origin as a CSP source (scheme://host[:port]), or null when it is not an http(s) origin. */
function cspOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * The file's Content-Security-Policy. Nothing may be fetched — `connect-src`
 * falls back to `default-src 'none'` — except ONE kind of script: code view's
 * extras, from the origin the file came from (and only by an SRI-pinned tag
 * lib/offline/extras inserts when code view is first opened).
 *
 * No `'unsafe-eval'`: charts evaluate Vega expressions with vega-interpreter,
 * and no served app page allows eval either. `'wasm-unsafe-eval'` admits
 * exactly one thing more — compiling WebAssembly — because the file runs its
 * queries on the embedded SQLite engine; Chromium, Firefox and WebKit all
 * refuse `WebAssembly.instantiate` from file:// without it (probed 2026-09-26). Measured by
 * scripts/gates/gate-offline-file.mjs, which counts `securitypolicyviolation`
 * events in Chromium, Firefox and WebKit (zero with this policy).
 */
export function artifactFileCsp(origin: string, sqlite = true): string {
  const scripts = ["'unsafe-inline'", sqlite ? "'wasm-unsafe-eval'" : null, cspOrigin(origin)].filter(Boolean).join(' ');
  return `default-src 'none'; script-src ${scripts}; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:`;
}

/**
 * An HTML comment's text that cannot end (or nest) the comment, whatever a
 * title holds: `-->`, `--!>` and `<!--` all need two dashes in a row.
 */
const commentSafe = (text: string) => text.replace(/-(?=-)/g, '- ');

/**
 * The note an agent reads first: what the file is and how to edit it
 * correctly — change the top-level `source` and nothing else. Every claim is
 * what the file really does (lib/offline/file-backend's rebuildArtifactFile,
 * lib/offline/solid-entry's banner); pinned by file-html.ui.test.
 */
function artifactFileAgentNote(file: Pick<ArtifactFile, 'origin' | 'liveUrl' | 'metadata'>): string {
  const help = agentDiscovery(file.origin);
  // The title as the JSON below writes it (quoted, `<` as \u003c): a title is the author's text, never markup here.
  const title = JSON.stringify(file.metadata.title).replace(/</g, '\\u003c');
  return `artifactbin offline file for ${title} (${file.liveUrl}). `
    + 'To edit the document, change the top-level "source" string (the second key) in the <script id="afbin-file"> JSON below. '
    + `It is artifactbin JSX (reference: ${help.url}; prepare Node/npm using ${help.url}). `
    + 'If afbin is not installed, run "npx @afbin/cli@latest setup" once (Windows PowerShell: "npx.cmd @afbin/cli@latest setup"); it installs the afbin command and the agent skills. Then read "afbin help markup". '
    + 'Keep the JSON valid and write "<" as \\u003c inside it. '
    + 'Leave "#afbin-code" untouched. '
    + 'Static markup/text edits rebuild on open; compiler-dependent widgets require local CLI preview. Invalid markup shows validation errors. '
    + 'To return to JSX, run "afbin import file.jsx.html"; publication is explicit. '
    + 'Comments are in "threads". Save or Cmd/Ctrl+S writes the current edits and comments to a .jsx.html file; the tab stays on the original file. '
    + 'For the full local editor, start "afbin preview" (Windows PowerShell: "afbin.cmd preview"), click "Connect to server", enter the printed server address, and confirm "Import and open" in its tab. A compatible HTTPS preview server also works. This creates a workspace copy, not a publication.';
}

export interface ArtifactFileParts {
  file: ArtifactFile;
  /** The offline bundle, gzip-compressed then base64-encoded. */
  code: string;
  /** The document's packed Solid module, gzip-compressed then base64-encoded. */
  compiledCode?: string;
  /** Embedded SQLite wasm only when this reader may hold imports: gzip then base64 (raw base64 in older files). */
  wasm?: string;
  /** Compiled DOM factories, inert text until the Solid runtime clones one. */
  templates?: Record<string, string>;
}

/** Element ids the shell, the boot script and the offline entry agree on. */
export const ARTIFACT_FILE_IDS = { code: 'afbin-code', compiledCode: 'afbin-compiled-code', wasm: 'afbin-wasm', file: 'afbin-file', root: 'afbin-root', boot: 'afbin-boot' } as const;

/** Shown in place of the document by a browser without DecompressionStream. */
export const ARTIFACT_FILE_UNSUPPORTED = 'This file needs a current version of Chrome, Edge, Firefox or Safari.';
const ARTIFACT_FILE_BROKEN = 'This file is damaged and cannot be opened. Download it again from artifactbin.';

/**
 * The one script the shell runs by itself. Plain ES5-ish text on purpose: it
 * must reach the unsupported-browser message in any browser that runs script
 * at all. It gunzips `#afbin-code` and runs the result as INLINE script text;
 * a data: fetch, a Blob URL or a module would each be refused somewhere.
 */
const ARTIFACT_FILE_BOOT = `(function(){
var d=document,status=d.getElementById(${scriptJson(ARTIFACT_FILE_IDS.boot)});
function fail(m){if(status){status.textContent=m;status.setAttribute('role','alert');}}
if(typeof DecompressionStream!=='function'||typeof Response!=='function'||typeof Uint8Array!=='function'){fail(${scriptJson(ARTIFACT_FILE_UNSUPPORTED)});return;}
function unpack(id){var el=d.getElementById(id);if(!el)return Promise.resolve(null);var raw=atob((el.textContent||'').replace(/\\s+/g,''));var bytes=new Uint8Array(raw.length);for(var i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return new Response(new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'))).text();}
function run(code){var s=d.createElement('script');s.textContent=code;d.body.appendChild(s);}
try{
unpack(${scriptJson(ARTIFACT_FILE_IDS.code)}).then(function(code){run(code);var compiled=d.getElementById(${scriptJson(ARTIFACT_FILE_IDS.compiledCode)});if(compiled){Promise.resolve(window.__afbinOfflineReady).then(function(){return unpack(${scriptJson(ARTIFACT_FILE_IDS.compiledCode)});}).then(function(next){if(next)run(next);},function(){fail(${scriptJson(ARTIFACT_FILE_BROKEN)});});}},function(){fail(${scriptJson(ARTIFACT_FILE_BROKEN)});});
}catch(e){fail(${scriptJson(ARTIFACT_FILE_BROKEN)});}
})();`;

/** The boot placeholder's look: system fonts, centred, both colour schemes. */
const BOOT_CSS = 'html{color-scheme:light dark}body{margin:0}#afbin-boot{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#6b6b70;padding:48px 16px;text-align:center;margin:0}';

/**
 * The file's JSON, inert inside its `<script type="application/json">`: every `<` escaped (no
 * `</script>` or `<!--` in a string can end or bend the block), U+2028/9 too. Deliberately NOT
 * utils' scriptJson, which also escapes `>`: an agent edits this text by hand (artifactFileAgentNote),
 * and `</h1>` stays readable as `\u003c/h1>` where scriptJson would write `\u003c/h1\u003e`.
 */
const fileJson = (value: unknown) => JSON.stringify(value)
  .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** The complete `.html` text for these parts. Pure; safe for any JSON content (no `</script>` break-out). */
export function renderArtifactFileHtml(parts: ArtifactFileParts): string {
  if (!BASE64.test(parts.code)) throw new ArtifactFileError('The offline bundle is not base64.');
  if (parts.compiledCode && !BASE64.test(parts.compiledCode)) throw new ArtifactFileError('The compiled bundle is not base64.');
  if (parts.wasm && !BASE64.test(parts.wasm)) throw new ArtifactFileError('The SQLite engine is not base64.');
  const { file } = parts;
  const title = escapeHtml(file.metadata.title);
  // A large document's module reads its dataflow literal by the reader page's
  // fixed id. The normal reader shell adds that id; this file owns its shell.
  const compiledHtml = file.compiled ? withModuleDataId(file.compiled.html) : '';
  const compiledStory = file.compiled ? inlineStoryElement(compiledHtml, file.metadata.colorMode ?? 'light', file.metadata.theme) : '';
  // `source` right after `format`: the first "source" in the text is the one to edit, not `base.source`.
  const { format, source, ...rest } = file;
  return `<!doctype html>\n<!-- ${commentSafe(artifactFileAgentNote(file))} -->\n<html lang="en" ${documentRootAttributes(file.metadata.colorMode, file.metadata.theme)}>\n<head>\n<meta charset="utf-8">\n`
    + `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(artifactFileCsp(file.origin, file.bundle !== 'solid' || !!parts.wasm))}">\n`
    + '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
    + `<title>${title}</title>\n${agentDiscoveryHead(agentDiscovery(file.origin))}\n<style>${BOOT_CSS}</style>\n</head>\n<body>\n`
    + `<div id="${ARTIFACT_FILE_IDS.root}">${compiledStory}<p id="${ARTIFACT_FILE_IDS.boot}" role="status">Opening ${title}\u2026</p></div>\n`
    + Object.entries(parts.templates ?? {}).map(([key, markup]) => `<template data-mx-island-template="${escapeHtml(key)}">${escapeHtml(markup)}</template>\n`).join('')
    + `<script type="application/json" id="${ARTIFACT_FILE_IDS.file}">${fileJson({ format, source, ...rest })}</script>\n`
    + `<script type="application/octet-stream" id="${ARTIFACT_FILE_IDS.code}">${parts.code}</script>\n`
    + (parts.compiledCode ? `<script type="application/octet-stream" id="${ARTIFACT_FILE_IDS.compiledCode}">${parts.compiledCode}</script>\n` : '')
    + (parts.wasm ? `<script type="application/octet-stream" id="${ARTIFACT_FILE_IDS.wasm}">${parts.wasm}</script>\n` : '')
    + `<script>${ARTIFACT_FILE_BOOT}</script>\n</body>\n</html>\n`;
}

/** Reads the parts back out of a parsed file document (DOMParser or the live page). Throws ArtifactFileError. */
export function readArtifactFileParts(doc: Document): ArtifactFileParts {
  const code = doc.getElementById(ARTIFACT_FILE_IDS.code)?.textContent?.replace(/\s+/g, '') ?? '';
  const json = doc.getElementById(ARTIFACT_FILE_IDS.file)?.textContent ?? '';
  if (!code || !json || !BASE64.test(code)) throw new ArtifactFileError(ARTIFACT_FILE_BROKEN);
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new ArtifactFileError(ARTIFACT_FILE_BROKEN); }
  const compiledCode = doc.getElementById(ARTIFACT_FILE_IDS.compiledCode)?.textContent?.replace(/\s+/g, '') ?? '';
  const wasm = doc.getElementById(ARTIFACT_FILE_IDS.wasm)?.textContent?.replace(/\s+/g, '') ?? '';
  const templates = Object.fromEntries([...doc.querySelectorAll<HTMLTemplateElement>('template[data-mx-island-template]')]
    .map((node) => [node.getAttribute('data-mx-island-template')!, node.content.textContent ?? '']));
  if ((compiledCode && !BASE64.test(compiledCode)) || (wasm && !BASE64.test(wasm))) throw new ArtifactFileError(ARTIFACT_FILE_BROKEN);
  return { file: parseArtifactFile(value), code, ...(compiledCode ? { compiledCode } : {}), ...(wasm ? { wasm } : {}),
    ...(Object.keys(templates).length ? { templates } : {}) };
}
