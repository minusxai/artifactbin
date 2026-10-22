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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>@${handle}</title><style>body{max-width:48rem;margin:4rem auto;padding:0 1.5rem;font:16px/1.6 system-ui,sans-serif;color:#202124;background:#fff}h1{font-size:1.8rem}ul{list-style:none;padding:0}li{border-top:1px solid #ddd;padding:1rem 0}a{color:inherit;text-underline-offset:.2em}nav{margin-top:2rem}p{color:#555}</style></head><body><main><h1>@${handle}</h1><p>Public pages</p>${page.files.length ? `<ul>${page.files.map((file) => `<li><a href="/a/${file.id}">${escape(file.title || "Untitled page")}</a></li>`).join("")}</ul>` : "<p>No public pages.</p>"}${page.next ? `<nav aria-label="Profile pages"><a href="${address}?after=${page.next}&amp;limit=${limit}">Next</a></nav>` : ""}</main></body></html>`;
}
