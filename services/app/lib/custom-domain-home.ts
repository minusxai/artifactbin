/**
 * THE HOME PAGE OF A CUSTOM DOMAIN — `/` on a verified host (server/custom-host).
 *
 * The owner's public documents as a plain, server-rendered list: a crawler and
 * a reader without JavaScript get every title, summary and link in the first
 * response. No app shell, no script, no chrome; the same quiet column and the
 * same "Made with artifactbin" line a post ends with. Theme-neutral: it follows
 * the reader's light or dark preference and nothing else.
 */
import { escapeHtml } from '@/lib/story/reader-chrome';
import { DOMAIN_FOOTER_TEXT } from '@/lib/story/document';
import { domainPostPath, type DomainPost } from '@/lib/custom-domains';

export interface DomainHomeInput {
  hostname: string;
  /** The owner's handle and display name; either may be missing. */
  owner: { username: string | null; name: string | null };
  posts: DomainPost[];
  /** Where the footer's "artifactbin" points: the owner's profile on the app. */
  footerHref: string;
}

/** The page's own policy: no script, no network beyond itself. */
export const DOMAIN_HOME_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const CSS = [
  ':root{color-scheme:light dark;--fg:#1c1c1a;--muted:#6b6b66;--rule:#e4e3dd;--bg:#fbfbf9;--link:#1c1c1a}',
  '@media (prefers-color-scheme:dark){:root{--fg:#ecebe6;--muted:#a3a29c;--rule:#33332f;--bg:#161615;--link:#ecebe6}}',
  '*{box-sizing:border-box}',
  'body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 ui-serif,Georgia,Cambria,"Times New Roman",serif;-webkit-font-smoothing:antialiased}',
  'main{max-width:680px;margin:0 auto;padding:64px 16px 24px}',
  'header h1{margin:0;font-size:28px;line-height:1.25;font-weight:600;letter-spacing:-0.01em}',
  'header p{margin:6px 0 0;color:var(--muted);font:14px/1.5 ui-sans-serif,system-ui,sans-serif}',
  'ol{list-style:none;margin:40px 0 0;padding:0}',
  'li{padding:20px 0;border-top:1px solid var(--rule)}',
  'li:last-child{border-bottom:1px solid var(--rule)}',
  'li a{color:var(--link);text-decoration:none}',
  'li a:hover h2,li a:focus-visible h2{text-decoration:underline;text-underline-offset:3px}',
  'h2{margin:0;font-size:20px;line-height:1.35;font-weight:600}',
  'li p{margin:6px 0 0;color:var(--muted)}',
  'time{display:block;margin-top:6px;color:var(--muted);font:13px/1.5 ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums}',
  '.empty{margin-top:40px;color:var(--muted)}',
  'footer{padding:40px 16px 48px;text-align:center;font:13px/1.5 ui-sans-serif,system-ui,sans-serif;color:var(--muted)}',
  'footer a{color:inherit;text-underline-offset:2px}',
].join('');

const DATE = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
const isoDate = (value: string | Date): string => (value instanceof Date ? value : new Date(value)).toISOString();

export function renderDomainHome(input: DomainHomeInput): string {
  const { hostname, owner, posts, footerHref } = input;
  const heading = owner.name?.trim() || (owner.username ? `@${owner.username}` : hostname);
  const byline = owner.name?.trim() && owner.username ? `@${owner.username}` : null;
  const description = `Writing by ${heading}.`;
  const canonical = `https://${hostname}/`;
  const items = posts.map((post) => {
    const title = post.title?.trim() || 'Untitled';
    const at = isoDate(post.created_at);
    return `<li><a href="${escapeHtml(domainPostPath(post))}"><h2>${escapeHtml(title)}</h2></a>`
      + (post.description ? `<p>${escapeHtml(post.description)}</p>` : '')
      + `<time datetime="${at}">${escapeHtml(DATE.format(new Date(at)))}</time></li>`;
  }).join('');
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>${escapeHtml(heading)}</title>`
    + `<link rel="canonical" href="${escapeHtml(canonical)}">`
    + `<meta name="description" content="${escapeHtml(description)}">`
    + `<meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(heading)}">`
    + `<meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}">`
    + `<style>${CSS}</style></head><body><main>`
    + `<header><h1>${escapeHtml(heading)}</h1>${byline ? `<p>${escapeHtml(byline)}</p>` : ''}</header>`
    + (items ? `<ol>${items}</ol>` : '<p class="empty">Nothing published here yet.</p>')
    + `</main><footer>${DOMAIN_FOOTER_TEXT} <a href="${escapeHtml(footerHref)}" rel="noopener">artifactbin</a></footer></body></html>`;
}
