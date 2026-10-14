/** What a reader sees when the selected file cannot be shown: the file, the problem, and that fixing it is enough. */
const escape=(text:string)=>text.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]!);

/**
 * A static page (no script). For a reader it asks again every few seconds, so an agent's fix shows without a manual
 * reload; an export's capture gets it once, standing still, and reports the same problem itself.
 */
export const PROBLEM_PAGE_POLICY="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export function previewProblemPage(file:string,problem:string,{refresh=true}:{refresh?:boolean}={}):string {
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh?'<meta http-equiv="refresh" content="3">':''}<title>${escape(file)} cannot be shown</title>`
  +'<style>body{font:15px/1.5 system-ui,sans-serif;max-width:44rem;margin:12vh auto;padding:0 16px;color:#1f2328;background:#fff}h1{font-size:1.25rem;margin:0 0 .75rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,monospace;padding:12px;border:1px solid #d0d7de;border-radius:6px;background:#f6f8fa}p{color:#57606a}@media(prefers-color-scheme:dark){body{color:#e6edf3;background:#0d1117}pre{border-color:#30363d;background:#161b22}p{color:#8d96a0}}</style></head>'
  +`<body><main><h1><code>${escape(file)}</code> cannot be shown</h1><pre role="alert">${escape(problem)}</pre>${refresh?'<p>Fix the file and save it. This page checks again every few seconds.</p>':''}</main></body></html>`;
}
