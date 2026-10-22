import { chromeCSS } from "../chrome-assets.js";
import type { PublicProfilePage } from "./public-profile-contracts.ts";
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function publicProfileHtml(
  page: PublicProfilePage,
  limit: number,
): string {
  const handle = escape(page.handle),
    address = "/@" + encodeURIComponent(page.handle);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>@${handle}</title><style>${chromeCSS}main{max-width:960px;margin:0 auto;padding:48px 24px 80px}h1{font:600 32px/1.2 var(--pg-sans);letter-spacing:-.7px;margin:0 0 12px;overflow-wrap:anywhere}.profile-caption{margin:0 0 32px;color:var(--pg-muted)}.profile-list{list-style:none;padding:0;margin:0;border:1px solid var(--pg-edge);border-radius:8px;background:var(--pg-bg);overflow:hidden}.profile-list li+li{border-top:1px solid var(--pg-edge)}.profile-list a{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:20px 24px;color:var(--pg-fg);text-decoration:none;font-size:16px;overflow-wrap:anywhere}.profile-list a:hover{background:var(--pg-raised)}.profile-list a:focus-visible{outline:2px solid var(--pg-accent);outline-offset:-3px}.profile-list a::after{content:'↗';color:var(--pg-muted);flex-shrink:0}.profile-pagination{margin-top:24px}.profile-pagination a:focus-visible{outline:2px solid var(--pg-accent);outline-offset:4px;border-radius:2px}.profile-empty{color:var(--pg-muted)}@media(max-width:600px){main{padding:32px 20px 64px}h1{font-size:28px}.profile-list a{padding:18px 20px}}</style></head><body><nav class="pg-bar" aria-label="artifactbin"><a class="brand" href="/">artifactbin</a><span class="pg-crumb">Public profile</span></nav><main><h1>@${handle}</h1><p class="profile-caption">Public pages</p>${page.files.length ? `<ul class="profile-list">${page.files.map((file) => `<li><a href="/a/${file.id}">${escape(file.title || "Untitled page")}</a></li>`).join("")}</ul>` : '<p class="profile-empty">No public pages.</p>'}${page.next ? `<nav class="profile-pagination" aria-label="Profile pages"><a href="${address}?after=${page.next}&amp;limit=${limit}">Next</a></nav>` : ""}</main></body></html>`;
}
