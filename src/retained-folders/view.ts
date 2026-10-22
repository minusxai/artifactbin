import { chromeCSS } from "../chrome-assets.js";
import type { RetainedFolderPage } from "./contracts.ts";
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
/** All source titles are text; this view carries no scripts, credentials or authority claims. */
export function retainedFolderHtml(page: RetainedFolderPage): string {
  const trail = page.trail
    .map(
      (row) =>
        `<li><a href="${escape(row.url)}">${escape(row.title || "Untitled folder")}</a></li>`,
    )
    .join("");
  const rows = page.rows
    .map(
      (row) =>
        `<li><a href="${escape(row.url)}"><span>${escape(row.title || (row.kind === "folder" ? "Untitled folder" : "Untitled page"))}</span><span class="folder-kind">${row.kind === "folder" ? "Folder" : "Page"}</span></a></li>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(page.title || "Untitled folder")}</title><link rel="canonical" href="/a/${page.id}"><style>${chromeCSS}main{max-width:960px;margin:0 auto;padding:48px 24px 80px}h1{font:600 32px/1.2 var(--pg-sans);letter-spacing:-.7px;margin:0 0 12px;overflow-wrap:anywhere}.folder-caption,.folder-empty{color:var(--pg-muted)}.folder-caption{margin:0 0 32px}.folder-trail{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:0 0 24px}.folder-trail li+li::before{content:'/';margin-right:8px;color:var(--pg-muted)}.folder-trail a{color:var(--pg-muted);text-underline-offset:3px}.folder-list{list-style:none;padding:0;margin:0;border:1px solid var(--pg-edge);border-radius:8px;background:var(--pg-bg);overflow:hidden}.folder-list li+li{border-top:1px solid var(--pg-edge)}.folder-list a{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:20px 24px;color:var(--pg-fg);text-decoration:none;overflow-wrap:anywhere}.folder-list a:hover{background:var(--pg-raised)}.folder-list a:focus-visible{outline:2px solid var(--pg-accent);outline-offset:-3px}.folder-kind{font-size:12px;color:var(--pg-muted);flex-shrink:0}@media(max-width:600px){main{padding:32px 20px 64px}h1{font-size:28px}.folder-list a{padding:18px 20px}}</style></head><body><nav class="pg-bar" aria-label="artifactbin"><a class="brand" href="/">artifactbin</a><span class="pg-crumb">Folder</span></nav><main>${trail ? `<nav aria-label="Folder ancestors"><ol class="folder-trail">${trail}</ol></nav>` : ""}<h1>${escape(page.title || "Untitled folder")}</h1><p class="folder-caption">${page.rows.length} ${page.rows.length === 1 ? "item" : "items"}</p>${rows ? `<ul class="folder-list" aria-label="Folder contents">${rows}</ul>` : '<p class="folder-empty">No items to show.</p>'}</main></body></html>`;
}
